// The tracer: spans, context propagation, and a store that cannot take
// the agent down with it.
//
// OBSERVABILITY THAT CAN BREAK THE REQUEST IS WORSE THAN NONE. Every
// path here is wrapped. A trace store that is full, locked or missing
// degrades to NO TRACES, never to no agent — and the failures are
// counted so "we have no traces" is itself visible rather than silent.
//
// CONTEXT PROPAGATES THROUGH AsyncLocalStorage, Node's built-in ambient
// context that follows the async call chain. The alternative is
// threading a tracer argument through every function that might emit a
// span, at which point instrumentation becomes the thing nobody is
// willing to add and the traces stop at the first layer somebody was in
// a hurry through.

import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { pseudonym, redactDeep } from "./redact.js";
import type { Versions } from "./versions.js";

export type SpanType =
  | "turn"
  | "llm"
  | "tool"
  | "knowledge"
  | "memory"
  | "policy"
  | "escalation";

export type Outcome = "ok" | "error" | "denied";

export interface Span {
  traceId: string;
  spanId: string;
  parentId: string | null;
  sessionId: string;
  /** Pseudonymised. The trace store never holds a member id. */
  subject: string;
  type: SpanType;
  name: string;
  startedAt: string;
  durationMs: number;
  input: unknown;
  output: unknown;
  tokensIn: number;
  tokensOut: number;
  costAud: number;
  versions: Versions;
  outcome: Outcome;
  error?: string;
  /** Which PII categories were masked. Useful on its own. */
  redacted: string[];
}

interface Ctx {
  traceId: string;
  spanId: string;
  sessionId: string;
  subject: string;
}

const context = new AsyncLocalStorage<Ctx>();

// ── the store ───────────────────────────────────────────────────

let db: DatabaseSync | undefined;
/**
 * The path `db` was opened with.
 *
 * Without this the handle is cached forever, and a test that points
 * TRACE_DB at a broken path gets the previous working connection — so
 * the "a failing store does not fail the request" test passed while
 * exercising a perfectly good store. It proved nothing, and only the
 * control found that out.
 */
let dbPath: string | undefined;
let buffer: Span[] = [];
let dropped = 0;
let flushing = false;

/** How many spans were lost. Exposed so "no traces" is not silent. */
export const health = () => ({ buffered: buffer.length, dropped });

function open(): DatabaseSync | undefined {
  const want = process.env.TRACE_DB ?? ".traces.db";
  if (db && dbPath === want) return db;
  try {
    db = new DatabaseSync(want);
    dbPath = want;
    db.exec(`
      CREATE TABLE IF NOT EXISTS spans (
        spanId TEXT PRIMARY KEY,
        traceId TEXT NOT NULL,
        parentId TEXT,
        sessionId TEXT NOT NULL,
        subject TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        durationMs INTEGER NOT NULL,
        tokensIn INTEGER NOT NULL,
        tokensOut INTEGER NOT NULL,
        costAud REAL NOT NULL,
        outcome TEXT NOT NULL,
        modelVersion TEXT NOT NULL,
        promptVersion TEXT NOT NULL,
        policyVersion TEXT NOT NULL,
        corpusVersion TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trace ON spans(traceId, startedAt);
      CREATE INDEX IF NOT EXISTS idx_session ON spans(sessionId);
      CREATE INDEX IF NOT EXISTS idx_time ON spans(startedAt);
    `);
    return db;
  } catch {
    // No store. The agent carries on; the counter records the loss.
    db = undefined;
    dbPath = undefined;
    return undefined;
  }
}

/**
 * Write buffered spans. Never throws, never blocks a turn.
 *
 * Called on a timer and at exit. A failure here loses traces and
 * nothing else — which is the trade this whole file exists to make.
 */
export function flush(): void {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    const conn = open();
    if (!conn) {
      dropped += batch.length;
      return;
    }
    const stmt = conn.prepare(
      `INSERT OR REPLACE INTO spans
       (spanId, traceId, parentId, sessionId, subject, type, name, startedAt, durationMs,
        tokensIn, tokensOut, costAud, outcome,
        modelVersion, promptVersion, policyVersion, corpusVersion, payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (const s of batch) {
      stmt.run(
        s.spanId, s.traceId, s.parentId, s.sessionId, s.subject, s.type, s.name,
        s.startedAt, s.durationMs, s.tokensIn, s.tokensOut, s.costAud, s.outcome,
        s.versions.model, s.versions.prompt, s.versions.policy, s.versions.corpus,
        JSON.stringify({ input: s.input, output: s.output, error: s.error, redacted: s.redacted }),
      );
    }
  } catch {
    dropped += batch.length;
  } finally {
    flushing = false;
  }
}

let timer: NodeJS.Timeout | undefined;
function scheduleFlush(): void {
  if (timer) return;
  // unref, so a buffered span never keeps a CLI alive after its work.
  timer = setTimeout(() => {
    timer = undefined;
    flush();
  }, 250);
  timer.unref?.();
}

// ── emitting ────────────────────────────────────────────────────

let currentVersions: Versions = {
  model: "unknown", prompt: "unknown", policy: "unknown", corpus: "unknown",
};
export const setVersions = (v: Versions): void => {
  currentVersions = v;
};

/** Start a trace for one conversation. Everything inside it nests. */
export function trace<T>(
  args: { sessionId: string; memberId: string; traceId?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return context.run(
    {
      // ONE CONVERSATION IS ONE TRACE, and a conversation outlives a
      // turn — so the id is passed in and held by the session rather
      // than minted here. Minting per turn would give a member six
      // unrelated traces for one exchange, which is precisely the view
      // that makes an agent hard to debug.
      traceId: args.traceId ?? randomUUID(),
      spanId: "",
      sessionId: args.sessionId,
      subject: pseudonym(args.memberId),
    },
    fn,
  );
}

/**
 * Record a span around some work.
 *
 * Wraps rather than being called after, so the duration and the outcome
 * are facts rather than something the caller has to remember to report
 * correctly. Day 12 had a handoff package infer success by matching
 * prose because the outcome had been thrown away at the source.
 */
export async function span<T>(
  args: {
    type: SpanType;
    name: string;
    input?: unknown;
    /** Read from the result. Cheaper than making every caller report it. */
    /**
     * Read from the result. Cheaper than making every caller report it.
     *
     * `input` may be overridden here, for the case where the real input
     * is not known until the work has run — the knowledge call builds
     * its own context window inside ask(), and that window is the whole
     * reason the span exists. The first version accepted this field and
     * silently ignored it, so the trace recorded an empty prompt and a
     * debugging exercise stalled on a field that looked present.
     */
    meta?: (result: T) => {
      input?: unknown;
      output?: unknown;
      tokensIn?: number;
      tokensOut?: number;
      costAud?: number;
      outcome?: Outcome;
    };
  },
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = context.getStore();
  const spanId = randomUUID();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // No context means nobody opened a trace — the work still runs.
  const parent = ctx ? { ...ctx } : undefined;

  const emit = (
    outcome: Outcome,
    output: unknown,
    extra: Partial<Span> & { input?: unknown },
    error?: string,
  ) => {
    if (!parent) return;
    try {
      // REDACTED HERE, ON THE WAY IN. Not at display.
      const inRed = redactDeep(extra.input ?? args.input ?? null);
      const outRed = redactDeep(output ?? null);
      buffer.push({
        traceId: parent.traceId,
        spanId,
        parentId: parent.spanId || null,
        sessionId: parent.sessionId,
        subject: parent.subject,
        type: args.type,
        name: args.name,
        startedAt,
        durationMs: Date.now() - t0,
        input: inRed.value,
        output: outRed.value,
        tokensIn: extra.tokensIn ?? 0,
        tokensOut: extra.tokensOut ?? 0,
        costAud: extra.costAud ?? 0,
        versions: currentVersions,
        outcome,
        error,
        redacted: [...new Set([...inRed.found, ...outRed.found])],
      });
      scheduleFlush();
    } catch {
      dropped++;
    }
  };

  try {
    // Children see this span as their parent.
    const result = parent
      ? await context.run({ ...parent, spanId }, fn)
      : await fn();
    const m = args.meta?.(result) ?? {};
    emit(m.outcome ?? "ok", m.output ?? null, m);
    return result;
  } catch (e) {
    emit("error", null, {}, (e as Error).message);
    throw e;
  }
}

/** The trace this code is running inside, if any. */
export const currentTrace = (): string | undefined => context.getStore()?.traceId;

process.on("exit", flush);
