// The queue, and the feedback capture that makes it worth having.
//
// An escalation queue that only routes work is a to-do list. The value
// is in what comes back: for each one, what the human actually did, and
// whether the agent COULD have handled it.
//
// Of the first five situations the club named, three were things the
// agent could do and cannot yet — a missing knowledge entry, a missing
// tool, and a scope decision. Only two needed a person. Without the
// `missing` field the queue records that the agent gave up and not why,
// and the why is the actionable half.
//
// ESCALATION REASONS SORTED BY VOLUME ARE THE PRODUCT ROADMAP. This is
// the input to day 19's improvement loop, which is why the capture is
// built now rather than then.

import { DatabaseSync } from "node:sqlite";
import type { Handoff } from "./handoff.js";
import type { Missing } from "./policy.js";

export interface Resolution {
  resolvedAt: string;
  resolvedBy: string;
  whatIDid: string;
  /**
   * Could the agent have handled this?
   *
   * The single most valuable field in the system, and the one a human
   * is uniquely placed to answer — they have just done the work.
   */
  agentCouldHave: boolean;
  /** If not, what was missing. Overrides the trigger's guess. */
  missing: Missing;
}

export type Row = Handoff & { resolution?: Resolution };

const DEFAULT_PATH = process.env.QUEUE_DB ?? ".queue.db";

export class Queue {
  private db: DatabaseSync;

  constructor(path = DEFAULT_PATH) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS escalations (
        ref TEXT PRIMARY KEY,
        raisedAt TEXT NOT NULL,
        memberId TEXT NOT NULL,
        triggerId TEXT NOT NULL,
        source TEXT NOT NULL,
        urgency TEXT NOT NULL,
        team TEXT NOT NULL,
        missing TEXT NOT NULL,
        payload TEXT NOT NULL,
        resolution TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_open ON escalations(resolution, urgency);
    `);
  }

  add(h: Handoff): Handoff {
    this.db
      .prepare(
        `INSERT INTO escalations
         (ref, raisedAt, memberId, triggerId, source, urgency, team, missing, payload)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(h.ref, h.raisedAt, h.memberId, h.triggerId, h.source, h.urgency, h.team, h.missing,
           JSON.stringify(h));
    return h;
  }

  /**
   * Open escalations, most urgent first.
   *
   * Ordered by urgency then by age, so the oldest immediate one is at
   * the top. A queue sorted only by time buries the bereavement under
   * four questions about opening hours.
   */
  open(): Row[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM escalations WHERE resolution IS NULL
         ORDER BY CASE urgency
           WHEN 'immediate' THEN 0 WHEN 'same_day' THEN 1 ELSE 2 END,
           raisedAt ASC`,
      )
      .all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as Row);
  }

  get(ref: string): Row | undefined {
    const r = this.db
      .prepare(`SELECT payload, resolution FROM escalations WHERE ref = ?`)
      .get(ref) as { payload: string; resolution: string | null } | undefined;
    if (!r) return undefined;
    const h = JSON.parse(r.payload) as Row;
    if (r.resolution) h.resolution = JSON.parse(r.resolution) as Resolution;
    return h;
  }

  resolve(ref: string, res: Resolution): boolean {
    const r = this.db
      .prepare(`UPDATE escalations SET resolution = ?, missing = ? WHERE ref = ? AND resolution IS NULL`)
      .run(JSON.stringify(res), res.missing, ref);
    return Number(r.changes) > 0;
  }

  /**
   * The roadmap: what the agent was missing, by volume.
   *
   * Only counts RESOLVED escalations, because the trigger's `missing`
   * is a guess and the human's is a finding. An unresolved queue tells
   * you what the agent gave up on; a resolved one tells you what to
   * build.
   */
  roadmap(): { missing: string; count: number; triggers: string }[] {
    return this.db
      .prepare(
        `SELECT missing, COUNT(*) as count, GROUP_CONCAT(DISTINCT triggerId) as triggers
         FROM escalations WHERE resolution IS NOT NULL
         GROUP BY missing ORDER BY count DESC`,
      )
      .all() as { missing: string; count: number; triggers: string }[];
  }

  close(): void {
    this.db.close();
  }
}

// ── assisted mode ───────────────────────────────────────────────
//
// The agent gathers, verifies and DRAFTS the action; a human approves
// it before it executes. You get most of the efficiency with a hard
// safety ceiling, and it is often the right first release for anything
// irreversible.
//
// The case here has been queued since day 10: cancelling within 24
// hours of a tee time incurs a $15 fee, and that rule lived only in a
// tool description — a request to the model, not a guarantee. A member
// could be charged without being warned.
//
// WHAT MAKES THIS ASSISTED RATHER THAN AN ESCALATION: the human is not
// being asked to work out what to do. They are being shown one action,
// with its exact arguments and its exact consequence, and asked yes or
// no. That is a ten-second decision instead of a phone call.

export interface PendingAction {
  ref: string;
  raisedAt: string;
  memberId: string;
  /** The tool that will run, verbatim. No paraphrase. */
  tool: string;
  args: Record<string, unknown>;
  /**
   * What it does, in one line STAFF can approve or refuse.
   *
   * Written for the console. It was once interpolated into the
   * member-facing sentence and produced "so cancel 2026-08-27 at 09:00
   * for m-1001 and charge the $15 late cancellation fee. needs the pro
   * shop to sign it off" — mangled grammar, a lowercased member id, and
   * the fourth time internal text reached the wrong audience.
   *
   * Each audience gets its own sentence, composed from the structured
   * fields below. Never from each other's.
   */
  effect: string;
  /** Structured, so a member-facing sentence can be written from scratch. */
  when?: string;
  fee?: number;
  /** Why it needs a human at all. */
  because: string;
  decision?: { at: string; by: string; approved: boolean; note: string };
}

export class Actions {
  private db: DatabaseSync;

  constructor(path = process.env.QUEUE_DB ?? ".queue.db") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actions (
        ref TEXT PRIMARY KEY,
        raisedAt TEXT NOT NULL,
        memberId TEXT NOT NULL,
        payload TEXT NOT NULL,
        decision TEXT
      );
    `);
  }

  propose(a: PendingAction): PendingAction {
    this.db
      .prepare(`INSERT INTO actions (ref, raisedAt, memberId, payload) VALUES (?,?,?,?)`)
      .run(a.ref, a.raisedAt, a.memberId, JSON.stringify(a));
    return a;
  }

  pending(): PendingAction[] {
    const rows = this.db
      .prepare(`SELECT payload FROM actions WHERE decision IS NULL ORDER BY raisedAt ASC`)
      .all() as { payload: string }[];
    return rows.map((r) => JSON.parse(r.payload) as PendingAction);
  }

  get(ref: string): PendingAction | undefined {
    const r = this.db
      .prepare(`SELECT payload, decision FROM actions WHERE ref = ?`)
      .get(ref) as { payload: string; decision: string | null } | undefined;
    if (!r) return undefined;
    const a = JSON.parse(r.payload) as PendingAction;
    if (r.decision) a.decision = JSON.parse(r.decision) as PendingAction["decision"];
    return a;
  }

  /**
   * Record a decision. Returns false if one already exists.
   *
   * The guard matters: approving twice must not execute twice, and the
   * console is a place where somebody will press the same key again
   * after a slow response.
   */
  decide(ref: string, d: NonNullable<PendingAction["decision"]>): boolean {
    const r = this.db
      .prepare(`UPDATE actions SET decision = ? WHERE ref = ? AND decision IS NULL`)
      .run(JSON.stringify(d), ref);
    return Number(r.changes) > 0;
  }

  close(): void {
    this.db.close();
  }
}
