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
import { rulesFrom } from "../core/rules.js";
import { loadStructured } from "../core/corpus.js";
import { amendBooking, bookTeeTime, cancelBooking, checkAvailability } from "../tools/tee-sheet.js";
import { BASE, resetCircuit } from "../tools/client.js";
import { clearAll, forget, pending } from "../tools/idempotency.js";
import { confirmBooking, holdSlot } from "../tools/tee-sheet.js";
import { unlinkSync, existsSync } from "node:fs";

// FROM THE SAME PLACE THE TOOLS GET IT.
//
// This was hardcoded to :4010 while the tools read TEE_SHEET_URL — two
// sources of truth for one address. On a spare port the control
// endpoints went to 4010 and the tools went elsewhere; with a server
// already on 4010 the suite's own spawned server failed to bind, died
// silently, and every check ran against a stranger's server with
// whatever state and hostility settings it happened to have.
//
// A suite that silently adopts somebody else's server can pass for
// reasons that have nothing to do with the code.
const IDEM = ".idempotency.json";

const api = async (path: string, init?: RequestInit) =>
  (await fetch(`${BASE}${path}`, init)).json();
const hostility = (h: Record<string, unknown>) =>
  api("/_hostility", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(h) });
const reset = async () => {
  await api("/_reset", { method: "POST" });
  await hostility({ latencyMs: 0, errorRate: 0, timeoutRate: 0, flakyWrites: false });
  resetCircuit();
  // Memory AND disk. Unlinking alone left the in-memory Map intact.
  clearAll();
  if (existsSync(IDEM)) unlinkSync(IDEM);
};
const state = () =>
  api("/_state") as Promise<{ bookings: { id: string; slotId: string }[]; holds: unknown[] }>;

const clubRules = rulesFrom(loadStructured());
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

// FAIL LOUDLY IF IT DID NOT COME UP. The spawn used to fail in silence
// when the port was taken, and the suite carried on against whatever
// was listening.
const alive = await fetch(`${BASE}/_state`).then((r) => r.ok).catch(() => false);
if (!alive) {
  console.error(`\n  the tee sheet is not answering on ${BASE}.`);
  console.error(`  something else may be using the port — try TEE_SHEET_PORT=4011 TEE_SHEET_URL=http://localhost:4011\n`);
  server.kill();
  process.exit(2);
}

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
      bookTeeTime({ slotId: SLOT, memberId: "M-1001", partySize: 2, guests: 0, sessionId: "S-a", clubRules, step: 1 }),
      bookTeeTime({ slotId: SLOT, memberId: "M-1002", partySize: 2, guests: 0, sessionId: "S-b", clubRules, step: 1 }),
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

  // ═══ 5. THE WRONG COLLISION ═══════════════════════════════════
  //
  // Book, cancel, book the SAME SLOT AGAIN, all in one session.
  //
  // Every check above this one runs in a FRESH SESSION, which is
  // exactly the variable this bug needs — so the suite was blind to it
  // while bookTeeTime had `step: 1` hardcoded and every booking in a
  // session shared one idempotency key. The member cancelled, booked
  // again, and was handed the CANCELLED booking's reference.
  //
  // Day 10's reflection described this failure in prose while the code
  // was already committing it. A hypothetical in a document is not a
  // test; only a test is a test.
  console.log("\n5. the wrong collision — book, cancel, rebook in ONE session");
  await reset();
  {
    const session = "S-rebook";
    const first = await bookTeeTime({
      slotId: SLOT, memberId: "M-1001", partySize: 1, guests: 0, sessionId: session, clubRules, step: 1,
    });
    if (first.status !== "booked") throw new Error(`setup failed: ${first.status}`);

    await cancelBooking({
      bookingId: first.bookingId, memberId: "M-1001", sessionId: session, step: 2,
    });

    const second = await bookTeeTime({
      slotId: SLOT, memberId: "M-1001", partySize: 1, guests: 0, sessionId: session, clubRules, step: 3,
    });

    check("the rebooking succeeded", second.status === "booked", `(${second.status})`);
    check("it is a NEW reference, not the cancelled one",
      second.status === "booked" && second.bookingId !== first.bookingId,
      second.status === "booked" ? `${first.bookingId} → ${second.bookingId}` : "");

    const world = await state();
    check("the tee sheet holds exactly one live booking",
      world.bookings.length === 1, `(${world.bookings.length})`);
  }

  // ═══ 6. AMEND, AND THE COMPENSATION WHEN IT FAILS ═════════════
  //
  // The tee sheet has no PATCH, so changing a booking is physically a
  // cancel and a rebook — and between them the slot is free for anyone.
  // A member who asked to move to a busier time must not end up with
  // NOTHING because someone got there first.
  console.log("\n6. amend — and the compensation when the new slot is gone");
  await reset();
  {
    const wanted = `${tomorrow}T13:00`;
    const mine = await bookTeeTime({
      slotId: SLOT, memberId: "M-1001", partySize: 1, guests: 0,
      sessionId: "S-amend", clubRules, step: 1,
    });
    if (mine.status !== "booked") throw new Error(`setup failed: ${mine.status}`);

    // Someone else takes the slot our member is about to move to.
    const theirs = await bookTeeTime({
      slotId: wanted, memberId: "M-1002", partySize: 1, guests: 0,
      sessionId: "S-other", clubRules, step: 1,
    });
    if (theirs.status !== "booked") throw new Error(`setup failed: ${theirs.status}`);

    const out = await amendBooking({
      bookingId: mine.bookingId, memberId: "M-1001",
      partySize: 1, guests: 0, slotId: wanted,
      sessionId: "S-amend", clubRules, step: 5,
    });

    check("the amend was refused", out.status === "not_permitted", `(${out.status})`);
    check("and it says WHY, in a sentence a member can act on",
      out.status === "not_permitted" && /took that slot/.test(out.reason),
      out.status === "not_permitted" ? out.reason : "");

    const world = await state();
    const restored = world.bookings.find((b) => b.slotId === SLOT);
    check("THE ORIGINAL BOOKING IS BACK", restored !== undefined,
      `(slots held: ${world.bookings.map((b) => b.slotId).join(", ")})`);
    check("and the other member still has theirs",
      world.bookings.some((b) => b.slotId === wanted));
    check("exactly two bookings exist — no duplicate, no loss",
      world.bookings.length === 2, `(${world.bookings.length})`);
  }

  // ═══ 7. CONTROL — an amend that succeeds leaves ONE booking ════
  console.log("\n7. control — a successful amend replaces, it does not duplicate");
  await reset();
  {
    const first = await bookTeeTime({
      slotId: SLOT, memberId: "M-1001", partySize: 1, guests: 0,
      sessionId: "S-amend2", clubRules, step: 1,
    });
    if (first.status !== "booked") throw new Error(`setup failed: ${first.status}`);

    const out = await amendBooking({
      bookingId: first.bookingId, memberId: "M-1001",
      partySize: 2, guests: 1,
      sessionId: "S-amend2", clubRules, step: 5,
    });

    check("the amend succeeded", out.status === "amended", `(${out.status})`);
    check("the guest count changed",
      out.status === "amended" && out.guests === 1, out.status === "amended" ? `${out.guests}` : "");
    check("it is a NEW reference",
      out.status === "amended" && out.bookingId !== first.bookingId);

    const world = await state();
    check("exactly ONE booking exists", world.bookings.length === 1, `(${world.bookings.length})`);
  }

  console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) FAILED`}\n`);
} finally {
  server.kill();
  if (existsSync(IDEM)) unlinkSync(IDEM);
}

process.exit(failures === 0 ? 0 : 1);
