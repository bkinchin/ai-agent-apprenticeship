// What the member reads, tested deterministically.
//
// Every defect in this layer so far was found by eye, in a live
// conversation, costing an API call each time — a debug label shown to
// a member, an invented phone number, a Node exception, a confirmation
// that omitted the guest fees, a slot substituted in silence.
//
// The member-facing sentence is the product. It deserves the same
// treatment as the booking logic: pure functions, fixed inputs, no
// model, no network, no luck.

import assert from "node:assert/strict";
import { test } from "node:test";
import { memberText, memoryOfferText, type Contact } from "./render.js";
import { leakySuggestion } from "./answer.js";
import type { Reply } from "./agent.js";

const contacts: Record<string, Contact> = {
  pro_shop: {
    name: "Pro Shop", phone: "02 9411 0388", email: "p@x.com",
    hours: "08:00–16:30 daily", handles: "bookings",
  },
  competition_secretary: {
    name: "Competition Secretary", phone: "02 9411 0386", email: "c@x.com",
    hours: "Tue and Thu mornings", handles: "competitions",
  },
};
const FEE = 20;
const show = (r: Reply) => memberText(r, contacts, FEE) ?? "";

const booked = (over: Partial<{ partySize: number; guests: number }> = {}, requested?: string): Reply => ({
  kind: "booking",
  requested,
  outcome: {
    status: "booked", bookingId: "B-123", slotId: "2026-08-29T09:40", time: "09:40",
    partySize: over.partySize ?? 1, guests: over.guests ?? 0, verified: true,
  },
});

// ═══ confirmations ════════════════════════════════════════════════
test("a solo booking names the day, the time and the reference", () => {
  const t = show(booked());
  assert.match(t, /Saturday 29 August/);
  assert.match(t, /09:40/);
  assert.match(t, /B-123/);
  assert.match(t, /just you/);
});

test("the weekday is right — no timezone slip", () => {
  // A date-only string has no timezone. Parsing it as local midnight
  // shifts the weekday west of the parse, so an agent in Sydney tells
  // a member "Friday" for a Saturday booking.
  assert.match(show(booked()), /Saturday/);
});

test("guests and their cost are stated, because those are the fields that cost money", () => {
  // A member said "just me" and was booked for four with three guests.
  // The confirmation named neither, so $60 was invisible until the
  // first tee.
  const t = show(booked({ partySize: 4, guests: 3 }));
  assert.match(t, /4 players/);
  assert.match(t, /3 guests/);
  assert.match(t, /\$60/, "3 guests x $20 must appear");
});

test("one guest is not pluralised", () => {
  const t = show(booked({ partySize: 2, guests: 1 }));
  assert.match(t, /1 guest\b/);
  assert.doesNotMatch(t, /1 guests/);
  assert.match(t, /\$20/);
});

test("a substituted slot is announced, not slipped in", () => {
  // Booking 09:50 for a member who asked for 09:40 is truthful and
  // still wrong: they have to spot it themselves, inside a sentence
  // shaped like a confirmation of what they wanted.
  const t = show(booked({}, "09:20"));
  assert.match(t, /09:20 had gone/);
  assert.match(t, /09:40/);
  assert.match(t, /B-123/);
});

test("no announcement when they got what they asked for", () => {
  assert.doesNotMatch(show(booked({}, "09:40")), /had gone/);
});

// ═══ failures ═════════════════════════════════════════════════════
test("a taken slot offers alternatives and says why", () => {
  const t = show({
    kind: "booking",
    outcome: {
      status: "slot_taken",
      alternatives: [{ slotId: "x", time: "09:00" }, { slotId: "y", time: "09:30" }],
    },
  });
  assert.match(t, /just taken/, "bad luck seconds ago, not a rule they fell foul of");
  assert.match(t, /09:00/);
  assert.match(t, /09:30/);
});

test("an outage and a bad member record say DIFFERENT things", () => {
  // A 404 on the member id was once reported as "I can't reach the tee
  // sheet". The tee sheet was up. A member told the wrong cause rings
  // back tomorrow and is told it was never down.
  const down = show({
    kind: "booking",
    outcome: { status: "unavailable", reason: "timeout", transient: true },
  });
  const badMember = show({
    kind: "booking",
    outcome: { status: "unavailable", reason: "no such member", transient: false },
  });
  assert.match(down, /can't reach the tee sheet/);
  assert.match(badMember, /membership record/);
  assert.notEqual(down, badMember);
});

test("no internal diagnostic ever reaches the member", () => {
  for (const r of [
    { kind: "error", text: "ECONNREFUSED 127.0.0.1:4010" },
    {
      kind: "booking",
      outcome: {
        status: "unavailable",
        reason: "network — write may or may not have landed, and this call is not idempotent",
        transient: true,
      },
    },
  ] as Reply[]) {
    const t = show(r);
    for (const leak of ["ECONNREFUSED", "idempoten", "127.0.0.1", "undefined", "[object"]) {
      assert.ok(!t.includes(leak), `"${leak}" must not appear in: ${t}`);
    }
  }
});

test("a trace is never shown to a member at all", () => {
  assert.equal(memberText({ kind: "trace", tool: "x", args: {}, note: "n", ok: true }, contacts, FEE), null);
});

// ═══ knowledge ════════════════════════════════════════════════════
test("an abstention gives a real contact, not a debug label", () => {
  const t = show({
    kind: "verbatim",
    answer: {
      status: "not_in_knowledge_base", answer: "", citations: [],
      reason: "nothing on dogs", contact: "competition_secretary", suggestion: "ask them",
    },
    badCitations: [],
    staleSources: [],
  });
  assert.doesNotMatch(t, /declined/i, "'[declined]' is a status, not a sentence");
  assert.match(t, /Competition Secretary/);
  assert.match(t, /02 9411 0386/, "the number must come from the corpus, not from source");
});

test("staleness reaches the member but citations do not", () => {
  const t = show({
    kind: "verbatim",
    answer: {
      status: "answered", answer: "The fee is $20.",
      citations: [{ source: "fees.yaml", quote: "green_fee: 20" }],
      reason: "", contact: "none", suggestion: "",
    },
    badCitations: [],
    staleSources: [{ id: "faq.md", reviewDue: "2026-01-01" }],
  });
  assert.match(t, /\$20/);
  assert.match(t, /overdue a review|out of date|confirming/i, "a stale answer must say so");
  assert.doesNotMatch(t, /fees\.yaml/, "source ids mean nothing to a member");
});

// ═══ memory ═══════════════════════════════════════════════════════
test("showing memories shows the receipt, not just the belief", () => {
  // "We think you prefer mornings" is surveillance. "You said, on this
  // date, in these words" is a receipt. The member's words ARE the
  // memory, so there is no paraphrase to disagree with.
  const t = show({
    kind: "memories",
    memories: [{
      id: "1", subjectId: "M-1001", type: "preference",
      key: "preferred_tee_time",
      value: "I always want to play before 9am",
      confidence: 0.95,
      source: { sessionId: "S", turnIndex: 1, quote: "I always want to play before 9am" },
      createdAt: "2026-03-03T00:00:00Z", lastConfirmedAt: "2026-03-03T00:00:00Z",
      expiresAt: "2027-03-03T00:00:00Z",
    }],
  });
  assert.match(t, /I always want to play before 9am/, "their own words");
  assert.match(t, /3 March 2026/, "when they said it");
  assert.match(t, /delete/i, "and how to get rid of it");
  assert.doesNotMatch(t, /you changed this/, "nothing was changed");
});

test("a corrected memory keeps the original visible", () => {
  // Value and quote diverge only when a person deliberately changed
  // something — and then the original is the evidence for a belief they
  // have since replaced, which is worth being able to see.
  const t = show({
    kind: "memories",
    memories: [{
      id: "1", subjectId: "M-1001", type: "preference",
      key: "preferred_tee_time", value: "afternoons", confidence: 1,
      source: { sessionId: "S", turnIndex: 1, quote: "I always want to play before 9am" },
      createdAt: "2026-03-03T00:00:00Z", lastConfirmedAt: "2026-09-01T00:00:00Z",
      expiresAt: "2027-09-01T00:00:00Z",
    }],
  });
  assert.match(t, /afternoons/, "what we now believe");
  assert.match(t, /you changed this/);
  assert.match(t, /1 September 2026/, "when they changed it");
  assert.match(t, /I always want to play before 9am/, "and what it replaced");
});

test("an empty memory store says so plainly", () => {
  const t = show({ kind: "memories", memories: [] });
  assert.match(t, /don't know anything about you/i);
});

// ═══ the offer to remember ════════════════════════════════════════
test("the offer quotes the member, not the storage value", () => {
  // It read: `Would you like me to remember that — "early"?`
  // "early" is a column value the model picked. A member cannot tell
  // what would be kept or what it would do, so the consent is not
  // informed.
  const t = memoryOfferText("I usually play early");
  assert.match(t, /I usually play early/, "their words, so there is no ambiguity");
  assert.match(t, /next time you book/, "and what it would actually do");
  assert.doesNotMatch(t, /^Would you like me to remember that for next time — "early"/);
});

test("the offer survives a quote that arrives already quoted", () => {
  assert.equal(
    memoryOfferText('"I usually play early"'),
    memoryOfferText("I usually play early"),
    "no doubled quote marks",
  );
});

// ═══ reverse handoff ══════════════════════════════════════════════
test("a resolved escalation is mentioned by CODE, not left to the model", () => {
  // The first version asked the model to mention it in the prompt. It
  // never did — the member's question went to search_knowledge, which
  // is terminal, so the turn ended and the model never spoke. Asking a
  // model to say something in a turn where it may not get a word in is
  // not a mechanism.
  const t = show({
    kind: "text",
    text: "Before anything else — Billy at the club looked at ESC-1 and got back to you: made an exception.",
  });
  assert.match(t, /Billy/);
  assert.match(t, /ESC-1/);
  assert.match(t, /made an exception/);
});

// ═══ the abstention branch's figure guard ═════════════════════════
test("routing details are not a leak", () => {
  // Day 9's guard tested for ANY digit, which was right when a
  // suggestion had no honest reason to contain one. Day 12 added
  // contacts.yaml, and "ring them on 02 9411 0388" is now both routing
  // and full of digits.
  for (const s of [
    "Ask the Pro Shop on 02 9411 0388.",
    "Email proshop@example-golf.com.au.",
    "Quote reference ESC-20260826-A1B2 when you call.",
    "Speak to the Club Secretary.",
  ]) {
    assert.equal(leakySuggestion(s), false, `should NOT be a leak: "${s}"`);
  }
});

test("a fact smuggled into routing IS a leak", () => {
  // The thing the guard exists for: a fee, a limit, a time or a date
  // delivered through the branch designed to be the safe one, with no
  // citation behind it.
  for (const s of [
    "Ask the pro shop — the guest fee is $20.",
    "You can book 6 weeks ahead; ask them to confirm.",
    "The bar closes at 23:00, but check with them.",
  ]) {
    assert.ok(leakySuggestion(s), `should be a leak: "${s}"`);
  }
});
