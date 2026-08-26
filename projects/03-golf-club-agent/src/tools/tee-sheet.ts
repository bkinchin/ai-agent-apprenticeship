// The tee-sheet tools.
//
// Seven primitives, and ONE orchestrated tool that the model actually
// sees. That split is the day's most useful design rule:
//
//   Never expose a four-step saga as four tools and hope the model
//   sequences them and cleans up after a failure. It will not — and
//   when it does not you get a slot held forever, or a fee charged
//   with no booking attached.
//
// The model proposes ONE intent. Code owns the whole transaction.

import { z } from "zod";
import { request, ToolError } from "./client.js";
import { idempotencyKey, once } from "./idempotency.js";

// ── response shapes. Never trust the supplier's. ────────────────
const Slot = z.object({ slotId: z.string(), date: z.string(), time: z.string() });
const Availability = z.object({ slots: z.array(Slot) });
const HoldResult = z.object({ holdId: z.string(), slotId: z.string(), expiresAt: z.string() });
const BookingResult = z.object({ bookingId: z.string(), slotId: z.string(), memberId: z.string() });
const Bookings = z.object({
  bookings: z.array(
    z.object({
      id: z.string(), slotId: z.string(), memberId: z.string(),
      guests: z.number(), partySize: z.number(),
    }),
  ),
});
const Allowance = z.object({
  memberId: z.string(),
  category: z.string(),
  liveBookings: z.number(),
  maxLiveBookings: z.number(),
  guestsUsedThisMonth: z.number(),
  maxGuestsPerMonth: z.number(),
});
const Competitions = z.object({
  competitions: z.array(
    z.object({ id: z.string(), name: z.string(), day: z.string(), from: z.string(), to: z.string() }),
  ),
});

// ── reads. Always safe to retry. ────────────────────────────────
export const checkAvailability = (date: string, from = "00:00", to = "23:59") =>
  request(`/availability?date=${date}&from=${from}&to=${to}`, Availability);

export const getMemberAllowance = (memberId: string) =>
  request(`/members/${memberId}/allowance`, Allowance);

export const listCompetitions = () => request("/competitions", Competitions);

export const listBookings = (memberId: string) =>
  request(`/bookings?memberId=${memberId}`, Bookings);

// ── writes ──────────────────────────────────────────────────────

/**
 * Claim a slot briefly.
 *
 * The hold is what closes the read-to-write gap. In a booking form that
 * gap is milliseconds; in a conversation it is however long the member
 * takes to decide, and forty seconds is an eternity for a Saturday
 * morning slot.
 *
 * Deliberately NOT idempotent, and it does not need to be: a duplicate
 * hold costs one slot for five minutes and then expires. The best
 * compensating action is the one you never have to write.
 */
export const holdSlot = (slotId: string, memberId: string, ttlSeconds = 300) =>
  request("/holds", HoldResult, {
    method: "POST",
    body: { slotId, memberId, ttlSeconds },
  });

/** The conversation is a heartbeat — a member still talking is evidence
 *  they are still engaged, so the hold only lapses on real silence. */
export const refreshHold = (holdId: string, ttlSeconds = 300) =>
  request(`/holds/${holdId}/refresh`, z.object({ holdId: z.string(), expiresAt: z.string() }), {
    method: "POST",
    body: { ttlSeconds },
  });

export const releaseHold = (holdId: string) =>
  request(`/holds/${holdId}`, z.object({ released: z.boolean() }), { method: "DELETE" });

/**
 * Convert a hold into a booking. THE IRREVERSIBLE STEP.
 *
 * Idempotent on our side, because the tee sheet does not support keys.
 * The reconcile function is what makes an ambiguous write survivable:
 * it asks whether a booking for THIS member and THIS slot already
 * exists, rather than the weaker "is this member booked", which a
 * member holding two live bookings would answer misleadingly.
 */
export async function confirmBooking(args: {
  holdId: string;
  slotId: string;
  memberId: string;
  partySize: number;
  guests: number;
  sessionId: string;
  step: number;
}) {
  const key = idempotencyKey(args.sessionId, args.step, "confirm_booking");

  return once(
    key,
    () =>
      request("/bookings", BookingResult, {
        method: "POST",
        idempotent: true, // the key above is what makes the retry safe
        body: {
          holdId: args.holdId,
          memberId: args.memberId,
          partySize: args.partySize,
          guests: args.guests,
        },
      }),
    async () => {
      // Did the previous attempt land? Match on member AND slot.
      const { bookings } = await listBookings(args.memberId);
      const found = bookings.find((b) => b.slotId === args.slotId);
      return found
        ? { bookingId: found.id, slotId: found.slotId, memberId: found.memberId }
        : undefined;
    },
  );
}

export async function cancelBooking(args: {
  bookingId: string;
  memberId: string;
  sessionId: string;
  step: number;
}) {
  const key = idempotencyKey(args.sessionId, args.step, "cancel_booking");
  return once(
    key,
    () =>
      request(`/bookings/${args.bookingId}`, z.object({ cancelled: z.boolean() }), {
        method: "DELETE",
        idempotent: true,
      }),
    async () => {
      const { bookings } = await listBookings(args.memberId);
      // Gone already means the previous attempt landed.
      return bookings.some((b) => b.id === args.bookingId) ? undefined : { cancelled: true };
    },
  );
}

// ── the one tool the model sees ─────────────────────────────────

export type BookOutcome =
  | {
      status: "booked";
      bookingId: string;
      slotId: string;
      time: string;
      /**
       * READ BACK FROM THE SHEET, not echoed from the request.
       *
       * These are the fields that cost money and the fields the model
       * is most likely to get wrong. A member said "the 9:20, just me,
       * I usually play early with the same three lads" and the model
       * sent partySize 4, guests 3 — $60 of guest fees nobody agreed
       * to. The slot ledger did not catch it because the SLOT was
       * legitimate; the ledger constrains which slot, never who.
       *
       * The confirmation named neither field, so the member would have
       * read "You're booked — Saturday 29 August at 09:20" and found
       * out about the other three at the first tee.
       */
      partySize: number;
      guests: number;
      /** False if the read-back failed and these came from the request. */
      verified: boolean;
    }
  | { status: "slot_taken"; alternatives: { slotId: string; time: string }[] }
  | { status: "not_permitted"; reason: string }
  /**
   * The call did not complete. `transient` decides what the member is told.
   *
   * These used to be one thing, and a 404 on the member ID was reported
   * as "I can't reach the tee sheet at the moment" — an outage message
   * for a system that was up. A member told the wrong cause rings back
   * tomorrow and is told it was never down.
   *
   * Day 10's retry table already draws this line (a 4xx is a fact about
   * the request; a timeout is a fact about the network). Flattening
   * both into one status threw that away at the boundary — which is
   * where classifications usually get lost, one layer above the code
   * that worked them out.
   */
  | { status: "unavailable"; reason: string; transient: boolean };

/**
 * Book a tee time: hold → validate → confirm → notify.
 *
 * ORDERING IS THE DESIGN. Reversible and cheap first; irreversible
 * last; the thing you cannot un-send last of all.
 *
 *   1. hold_slot          reversible, and expires on its own
 *   2. check allowance    a read — free, and reverses by doing nothing
 *   3. confirm_booking    IRREVERSIBLE
 *   4. confirmation email UN-SENDABLE — therefore last
 *
 * The hold comes before the allowance check even though the check is
 * cheaper, because the SLOT is the contended resource and the allowance
 * is not. Grab the scarce thing first; validate the uncontended things
 * while you hold it.
 *
 * A conflict is not an exception. `slot_taken` carries alternatives,
 * because the member needs a sentence, not a stack trace.
 */
export async function bookTeeTime(args: {
  slotId: string;
  memberId: string;
  partySize: number;
  guests: number;
  sessionId: string;
  /**
   * Monotonic within the session. NOT optional, and never a constant.
   *
   * This was hardcoded to 1, which gave every booking in a session the
   * same idempotency key. Book, cancel, book the same slot again, and
   * the third step returned the FIRST booking's reference — a member
   * told they hold a slot that was cancelled two turns ago.
   *
   * Day 10's reflection wrote this failure down as a hypothetical while
   * the code was already doing it. reliability.ts missed it because
   * every check runs in a fresh session, which is the one variable the
   * bug needs.
   */
  step: number;
}): Promise<BookOutcome> {
  const [date, time] = args.slotId.split("T");

  let hold: { holdId: string } | undefined;
  try {
    // 1 ── claim the scarce thing
    hold = await holdSlot(args.slotId, args.memberId);
  } catch (e) {
    const err = e as ToolError;
    if (err.kind === "conflict") {
      // ALTERNATIVES MUST BE NEAR THE TIME THEY ASKED FOR.
      //
      // This was `slots.slice(0, 3)` — the earliest three of the whole
      // day. A member asking for 09:20 was offered 07:00, 07:10 and
      // 07:20, which is not an alternative, it is a different plan.
      // Found by answering the reflection question "would you be happy
      // receiving that message?", which is a better test than any
      // assertion in the suite.
      const { slots } = await checkAvailability(date!, "00:00", "23:59").catch(() => ({ slots: [] }));
      const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
      const wanted = minutes(time!);
      const nearest = [...slots]
        .sort((a, b) => Math.abs(minutes(a.time) - wanted) - Math.abs(minutes(b.time) - wanted))
        .slice(0, 3)
        .sort((a, b) => minutes(a.time) - minutes(b.time)); // present in time order
      return {
        status: "slot_taken",
        alternatives: nearest.map((s) => ({ slotId: s.slotId, time: s.time })),
      };
    }
    return {
      status: "unavailable",
      reason: err.message,
      transient: err.kind === "timeout" || err.kind === "server" ||
        err.kind === "ratelimit" || err.kind === "circuit_open",
    };
  }

  try {
    // 2 ── validate while holding
    const allowance = await getMemberAllowance(args.memberId);
    if (allowance.liveBookings >= allowance.maxLiveBookings) {
      throw new NotPermitted(
        `you already have ${allowance.liveBookings} live bookings, which is the maximum`,
      );
    }
    if (args.guests > 0 && allowance.guestsUsedThisMonth + args.guests > allowance.maxGuestsPerMonth) {
      throw new NotPermitted(
        `that would use ${allowance.guestsUsedThisMonth + args.guests} guests this month, ` +
          `and your allowance is ${allowance.maxGuestsPerMonth}`,
      );
    }

    // 3 ── the irreversible step
    const booking = await confirmBooking({
      holdId: hold.holdId,
      slotId: args.slotId,
      memberId: args.memberId,
      partySize: args.partySize,
      guests: args.guests,
      sessionId: args.sessionId,
      step: args.step,
    });

    // 4 ── last, because it cannot be un-sent. And per the PRD it is
    //      generated FROM THE RECORD, never from what the agent said.
    queueConfirmationEmail(booking.bookingId);

    // READ THE RECORD BACK.
    //
    // The supplier's confirm response carries no party size or guest
    // count, and those are exactly the fields worth stating: they cost
    // money, and they are what the model gets wrong. Echoing the
    // request would close the model→code gap and leave the code→sheet
    // gap open; a GET closes both, and "generated from the record" is
    // the PRD's phrase, not "generated from what we meant to write".
    //
    // Changing the fake API to return them was the easier fix and the
    // wrong one. Real suppliers do not amend their contract because it
    // would suit your client.
    let partySize = args.partySize;
    let guests = args.guests;
    let verified = false;
    try {
      const { bookings } = await listBookings(args.memberId);
      const row = bookings.find((b) => b.id === booking.bookingId);
      if (row) {
        guests = row.guests;
        partySize = row.partySize;
        verified = true;
      }
    } catch {
      // The booking is made. A failed read-back is not a failed
      // booking, so fall back to what was written and say so rather
      // than turning a success into an error.
    }

    return {
      status: "booked",
      bookingId: booking.bookingId,
      slotId: booking.slotId,
      time: time!,
      partySize,
      guests,
      verified,
    };
  } catch (e) {
    // COMPENSATE. Best-effort release so the next member gets the slot
    // back in seconds rather than minutes — but the EXPIRY is the real
    // guarantee, which is why a failure here is swallowed rather than
    // becoming a second error path of its own.
    await releaseHold(hold.holdId).catch(() => {});

    if (e instanceof NotPermitted) return { status: "not_permitted", reason: e.message };
    const k = (e as ToolError).kind;
    return {
      status: "unavailable",
      reason: (e as Error).message,
      transient: k === "timeout" || k === "server" || k === "ratelimit" || k === "circuit_open",
    };
  }
}

class NotPermitted extends Error {}

/** Placeholder for the transactional email. Generated from the RECORD. */
function queueConfirmationEmail(bookingId: string): void {
  void bookingId;
}
