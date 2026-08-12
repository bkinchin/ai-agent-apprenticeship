// Making a write safe to repeat.
//
// The problem it solves is one specific thing: the write COMMITTED and
// then the response was lost. A timeout tells you nothing about whether
// it landed, and the naive retry creates a second booking.
//
// THE KEY IS DERIVED FROM INTENT, not from state or a clock.
//
//   ✗ a timestamp / random     always different → no protection at all
//   ✗ the arguments alone      a member legitimately booking the same
//                              slot twice (after cancelling) collides
//   ✓ session + step + tool    one intent, however many times it is sent
//
// The alternative — "look up whether they're already booked" — is
// weaker and it is worth knowing why. It identifies the OUTCOME, and
// outcomes are ambiguous: a member allowed two live bookings who
// already holds Sunday looks "booked" when the Saturday write failed.
// An idempotency key identifies the OPERATION, and operations are
// unique.
//
// Persisted to disk, because a process restart between the write and
// the retry is exactly when you need it most.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.IDEMPOTENCY_FILE ?? ".idempotency.json";

/**
 * `pending` is written BEFORE the call, `done` after it.
 *
 * A key stuck at `pending` is the fingerprint of an ambiguous write:
 * we started, and we do not know how it ended. That is the state a
 * naive store cannot represent, and not representing it is why a
 * timed-out write gets replayed.
 */
type Record_ =
  | { key: string; state: "pending"; at: string }
  | { key: string; state: "done"; result: unknown; at: string };

const load = (): Map<string, Record_> => {
  if (!existsSync(FILE)) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record_>));
  } catch {
    return new Map();
  }
};

const store = load();

/** In-flight calls, so a retry firing before the first returns waits
 *  for it rather than racing it. */
const inFlight = new Map<string, Promise<unknown>>();

function persist(): void {
  mkdirSync(dirname(FILE) === "." ? "." : dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(Object.fromEntries(store), null, 2));
}

export const idempotencyKey = (sessionId: string, step: number, tool: string) =>
  `${sessionId}:${step}:${tool}`;

/**
 * Run `fn` at most once per key, ever — including across the ambiguous
 * failure that this whole day exists for.
 *
 * Three states, and the middle one is the reason this is not four lines
 * of code:
 *
 *   done      → return the ORIGINAL result. Not a fresh one: the caller
 *               needs the booking reference that actually exists.
 *   pending   → a previous attempt started and we never learned how it
 *               ended. RECONCILE before doing anything.
 *   unknown   → never attempted. Run it.
 *
 * `reconcile` is what makes the middle state survivable when the server
 * does not understand idempotency keys — which is the situation the
 * golf club is actually in, because its tee sheet is a spreadsheet. It
 * goes and asks the world "did this land?" and is the only honest
 * answer available.
 *
 * Note what reconcile must look for: the EFFECT of this specific
 * operation — this member, this slot — never merely "is this member
 * booked". A member allowed two live bookings who already holds Sunday
 * looks booked when the Saturday write failed.
 */
export async function once<T>(
  key: string,
  fn: () => Promise<T>,
  reconcile?: () => Promise<T | undefined>,
): Promise<T> {
  const prior = store.get(key);
  if (prior?.state === "done") return prior.result as T;

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  if (prior?.state === "pending" && reconcile) {
    // We started once and never found out. Ask the world before
    // touching it again.
    const found = await reconcile();
    if (found !== undefined) {
      store.set(key, { key, state: "done", result: found, at: new Date().toISOString() });
      persist();
      return found;
    }
    // Genuinely did not land. Safe to proceed.
  }

  // Written BEFORE the call, so a crash between here and the response
  // leaves the fingerprint rather than nothing.
  store.set(key, { key, state: "pending", at: new Date().toISOString() });
  persist();

  const promise = (async () => {
    const result = await fn();
    store.set(key, { key, state: "done", result, at: new Date().toISOString() });
    persist();
    inFlight.delete(key);
    return result;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } catch (e) {
    // Deliberately left `pending`. The failure may have been ambiguous,
    // and forgetting it would licence exactly the replay we are
    // preventing. The next attempt reconciles.
    inFlight.delete(key);
    throw e;
  }
}

export const forget = (key: string) => {
  store.delete(key);
  persist();
};
export const seen = (key: string) => store.get(key)?.state === "done";
/** A key that started and never finished. Worth surfacing in ops. */
export const pending = () =>
  [...store.values()].filter((r) => r.state === "pending").map((r) => r.key);
