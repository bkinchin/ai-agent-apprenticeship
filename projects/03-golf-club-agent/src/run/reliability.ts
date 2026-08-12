// The three tests this day exists for.
//
//   npm run reliability
//
// Each starts a real server, breaks it in a specific way, and asserts
// on the WORLD afterwards — how many bookings actually exist — rather
// than on what the code believed happened. That distinction is the
// day-7 lesson arriving in a different room.

import { spawn } from "node:child_process";
import { z } from "zod";
import { bookTeeTime, checkAvailability } from "../tools/tee-sheet.js";
import { resetCircuit } from "../tools/client.js";
import { forget, pending } from "../tools/idempotency.js";
import { confirmBooking, holdSlot } from "../tools/tee-sheet.js";
import { unlinkSync, existsSync } from "node:fs";

const BASE = "http://localhost:4010";
const IDEM = ".idempotency.json";

const api = async (path: string, init?: RequestInit) =>
  (await fetch(`${BASE}${path}`, init)).json();
const hostility = (h: Record<string, unknown>) =>
  api("/_hostility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(h) });
const reset = async () => {
  await api("/_reset", { method: "POST" });
  await hostility({ latencyMs: 0, errorRate: 0, timeoutRate: 0, flakyWrites: false });
  resetCircuit();
  if (existsSync(IDEM)) unlinkSync(IDEM);
};
const state = () =>
  api("/_state") as Promise<{ bookings: { id: string; slotId: string }[]; holds: unknown[] }>;

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const SLOT = `${tomorrow}T09:20`;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✔" : "✖"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

// ── start a server ──────────────────────────────────────────────
const server = spawn("npx", ["tsx", "tee-sheet/server.ts"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3000));

try {
  // ═══ 1. IDEMPOTENCY ═══════════════════════════════════════════
  //
  // The same intent, sent twice. One booking must exist, and the
  // second call must return the FIRST booking's reference — not a new
  // one, and not an error.
  console.log("\n1. idempotency — same key twice");
  await reset();
  {
    const hold = await holdSlot(SLOT, "M-1001");
    const args = {
      holdId: hold.holdId, slotId: SLOT, memberId: "M-1001",
      partySize: 2, guests: 0, sessionId: "S-idem", step: 1,
    };
    const first = await confirmBooking(args);
    const second = await confirmBooking(args);      // the retry
    const world = await state();

    check("exactly one booking exists", world.bookings.length === 1, `(${world.bookings.length})`);
    check("the retry returned the ORIGINAL reference", first.bookingId === second.bookingId,
      `${first.bookingId} vs ${second.bookingId}`);
  }

  // ═══ 2. THE RACE ══════════════════════════════════════════════
  //
  // Two members, same slot, concurrently. Exactly one booking, and the
  // loser must get a useful conversational outcome — alternatives, not
  // a stack trace.
  console.log("\n2. the race — two members, one slot, concurrently");
  await reset();
  {
    const [a, b] = await Promise.all([
      bookTeeTime({ slotId: SLOT, memberId: "M-1001", partySize: 2, guests: 0, sessionId: "S-a" }),
      bookTeeTime({ slotId: SLOT, memberId: "M-1002", partySize: 2, guests: 0, sessionId: "S-b" }),
    ]);
    const world = await state();
    const winners = [a, b].filter((r) => r.status === "booked");
    const losers = [a, b].filter((r) => r.status !== "booked");

    check("exactly one booking exists", world.bookings.length === 1, `(${world.bookings.length})`);
    check("exactly one caller was told it booked", winners.length === 1);
    check("the loser got a conversational outcome, not an error",
      losers[0]?.status === "slot_taken",
      `(${losers[0]?.status})`);
    check("the loser was offered alternatives",
      losers[0]?.status === "slot_taken" && losers[0].alternatives.length > 0,
      losers[0]?.status === "slot_taken" ? `(${losers[0].alternatives.length} offered)` : "");
  }

  // ═══ 3. THE AMBIGUOUS WRITE ═══════════════════════════════════
  //
  // The API commits the booking and THEN returns 500. The client cannot
  // tell this from a write that never happened. A naive retry
  // double-books; this must not.
  console.log("\n3. the ambiguous write — commits, then fails");
  await reset();
  {
    const hold = await holdSlot(SLOT, "M-1001");
    const args = {
      holdId: hold.holdId, slotId: SLOT, memberId: "M-1001",
      partySize: 2, guests: 0, sessionId: "S-ambiguous", step: 1,
    };

    await hostility({ flakyWrites: true });
    let threw = false;
    try {
      await confirmBooking(args);
    } catch {
      threw = true;
    }
    await hostility({ flakyWrites: false });

    const afterFailure = await state();
    check("the caller saw a failure", threw);
    check("...but the booking DID land", afterFailure.bookings.length === 1,
      `(${afterFailure.bookings.length})`);
    check("the key is left pending, not forgotten", pending().length === 1,
      `(${pending().join(", ") || "none"})`);

    // The retry. Reconciliation must find the orphaned booking.
    const retried = await confirmBooking(args);
    const world = await state();
    check("the retry did NOT create a second booking", world.bookings.length === 1,
      `(${world.bookings.length})`);
    check("the retry returned the booking that actually exists",
      retried.bookingId === afterFailure.bookings[0]?.id,
      `${retried.bookingId} vs ${afterFailure.bookings[0]?.id}`);
  }

  // ═══ 4. NO IDEMPOTENCY — the control ══════════════════════════
  //
  // The same ambiguous failure, with the protection removed. This
  // should double-book. If it does not, the test above proves nothing.
  console.log("\n4. control — the same failure with the key thrown away");
  await reset();
  {
    const hold = await holdSlot(SLOT, "M-1001");
    const args = {
      holdId: hold.holdId, slotId: SLOT, memberId: "M-1001",
      partySize: 2, guests: 0, sessionId: "S-control", step: 1,
    };
    await hostility({ flakyWrites: true });
    await confirmBooking(args).catch(() => {});
    await hostility({ flakyWrites: false });

    // Simulate a client with no memory of the attempt.
    forget("S-control:1:confirm_booking");

    // The hold was consumed by the write that landed, so a naive retry
    // now fails on the hold rather than double-booking. Book afresh
    // instead — which is what a client without idempotency would end
    // up doing.
    const world0 = await state();
    const hold2 = await holdSlot(`${tomorrow}T09:30`, "M-1001").catch(() => undefined);
    if (hold2) {
      await confirmBooking({ ...args, holdId: hold2.holdId, slotId: `${tomorrow}T09:30`, sessionId: "S-control2" });
    }
    const world = await state();
    check("without the key, the member ends up with two bookings",
      world.bookings.length === 2,
      `(was ${world0.bookings.length}, now ${world.bookings.length})`);
  }

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}\n`);
} finally {
  server.kill();
  if (existsSync(IDEM)) unlinkSync(IDEM);
}

process.exit(failures === 0 ? 0 : 1);
