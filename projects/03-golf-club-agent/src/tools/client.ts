// The API client layer.
//
// Everything here is ordinary distributed-systems engineering. The LLM
// changes almost none of it — except by widening the read-to-write gap,
// because a human is talking in the middle.
//
// Four things this layer owns:
//
//   1. TIMEOUTS. A request with no timeout is a hang, and a hung agent
//      looks broken rather than slow.
//   2. A RETRY POLICY THAT IS A TABLE, not a judgement call at the call
//      site. Retrying the wrong thing is worse than not retrying.
//   3. A CIRCUIT BREAKER. After N consecutive failures, stop calling and
//      fail fast — this turns a slow cascading failure into a clean
//      degraded mode, and protects the supplier as well as us.
//   4. ZOD ON THE RESPONSE. Never trust an external API's shape. When
//      the supplier renames a field you want a loud validation error,
//      not `undefined` propagating into a booking confirmation.

import { z } from "zod";

const BASE = process.env.TEE_SHEET_URL ?? "http://localhost:4010";
const TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 3;

// ── the retry policy, as data ───────────────────────────────────
//
// NEVER RETRY A 4xx. The request was wrong; sending it again will still
// be wrong, and all you have done is turn one error into a rate limit.
//
// The interesting column is `safeWithoutIdempotency`. A GET can always
// be retried. A WRITE that timed out cannot — you do not know whether
// it landed, and retrying blind is exactly how you double-book. It is
// only safe when an idempotency key makes the retry a no-op.
export type Disposition =
  | { retry: false; kind: "validation" | "conflict" | "auth" | "notfound" | "unknown" }
  | { retry: true; kind: "timeout" | "ratelimit" | "server"; safeWithoutIdempotency: boolean };

export function disposition(status: number | "timeout" | "network"): Disposition {
  if (status === "timeout" || status === "network") {
    // The ambiguous case. Safe to retry ONLY with an idempotency key.
    return { retry: true, kind: "timeout", safeWithoutIdempotency: false };
  }
  if (status === 429) return { retry: true, kind: "ratelimit", safeWithoutIdempotency: true };
  if (status >= 500) return { retry: true, kind: "server", safeWithoutIdempotency: false };
  if (status === 409) return { retry: false, kind: "conflict" };
  if (status === 401 || status === 403) return { retry: false, kind: "auth" };
  if (status === 404) return { retry: false, kind: "notfound" };
  if (status >= 400) return { retry: false, kind: "validation" };
  return { retry: false, kind: "unknown" };
}

export class ToolError extends Error {
  constructor(
    readonly kind: Disposition["kind"] | "circuit_open",
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

// ── circuit breaker ─────────────────────────────────────────────
const breaker = { failures: 0, openUntil: 0 };
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

export const circuitState = () => ({
  open: Date.now() < breaker.openUntil,
  failures: breaker.failures,
  reopensIn: Math.max(0, breaker.openUntil - Date.now()),
});
export const resetCircuit = () => {
  breaker.failures = 0;
  breaker.openUntil = 0;
};

/** Jittered exponential backoff. Jitter matters — without it, every
 *  client retries in lockstep and you rebuild the thundering herd. */
const backoff = (attempt: number) =>
  Math.round((2 ** attempt * 200) * (0.5 + Math.random()));

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Present only when the caller can prove a retry is a no-op.
   *
   * The tee sheet does not support idempotency keys — the golf club's
   * is a Google Sheet — so this is not sent to the server. It is a
   * declaration by the caller that IT has already made the operation
   * idempotent on our side, which is what makes retrying a timed-out
   * write safe.
   */
  idempotent?: boolean;
}

export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  { method = "GET", body, idempotent = false }: RequestOptions = {},
): Promise<T> {
  if (Date.now() < breaker.openUntil) {
    throw new ToolError(
      "circuit_open",
      `tee sheet unavailable — not retrying for ${Math.ceil((breaker.openUntil - Date.now()) / 1000)}s`,
    );
  }

  let lastError: ToolError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, backoff(attempt)));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let status: number | "timeout" | "network";
    let payload: unknown;

    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      status = res.status;
      payload = await res.json().catch(() => ({}));
    } catch (e) {
      status = (e as Error).name === "AbortError" ? "timeout" : "network";
    } finally {
      clearTimeout(timer);
    }

    if (status === 200) {
      breaker.failures = 0;
      // NEVER TRUST THE SHAPE. A supplier field rename should be a loud
      // error here, not an undefined three layers downstream.
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new ToolError("validation", `unexpected response shape: ${parsed.error.message}`);
      }
      return parsed.data;
    }

    const d = disposition(status);
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error: unknown }).error)
        : String(status);
    lastError = new ToolError(d.kind, message, typeof status === "number" ? status : undefined);

    if (!d.retry) {
      // A 4xx is a fact about the request, not about the network.
      // It does not count against the breaker.
      throw lastError;
    }

    breaker.failures++;
    if (breaker.failures >= BREAKER_THRESHOLD) {
      breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
      throw new ToolError("circuit_open", "too many consecutive failures — circuit opened");
    }

    // THE LINE THAT MATTERS. A timed-out or 5xx write may already have
    // landed. Retrying without idempotency is how one booking becomes
    // two — so we stop and hand the ambiguity upward rather than
    // guessing.
    if (!d.safeWithoutIdempotency && method !== "GET" && !idempotent) {
      throw new ToolError(
        d.kind,
        `${message} — write may or may not have landed, and this call is not idempotent`,
        typeof status === "number" ? status : undefined,
      );
    }
  }

  throw lastError ?? new ToolError("unknown", "exhausted retries");
}
