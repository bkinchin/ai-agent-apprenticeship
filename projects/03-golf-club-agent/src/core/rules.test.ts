// Every rule in booking-rules.yaml, enforced and tested.
//
// An audit prompted by one reported bug — a member booked into the
// Saturday competition window — found three of six rules enforced
// NOWHERE and two delegated to the supplier's own responses. The
// booking path had never read the club's rulebook.
//
//   4 guests in ONE booking (rule says 2)     → booked. $80, 2 turned away.
//   a slot 10 minutes away (rule says 1h)     → booked.
//   Saturday 09:00 (competition window)       → booked.
//
// A rule the club writes down and the agent does not enforce is worse
// than no rule, because everyone believes it is being applied.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkBooking, reconcileLimit, rulesFrom, type ClubRules } from "./rules.js";
import { loadStructured } from "./corpus.js";

const rules = rulesFrom(loadStructured());
const NOW = new Date("2026-08-26T10:00:00+10:00");

test("the rulebook is read, not hardcoded", () => {
  // max_days_ahead was `42` in TypeScript AND in the yaml, so changing
  // the club's rule would have changed what the agent SAYS and not what
  // it DOES.
  assert.equal(rules.maxDaysAhead, 42);
  assert.equal(rules.maxLivePerMember, 2);
  assert.equal(rules.minNoticeHours, 1);
  assert.equal(rules.maxGuestsPerBooking, 2);
  assert.equal(rules.maxGuestsPerMonth, 6);
  assert.equal(rules.closures.length, 1);
});

test("the competition window is refused", () => {
  const v = checkBooking({ slotId: "2026-08-29T09:00", guests: 0 }, rules, NOW);
  assert.ok(v, "Saturday 09:00 is inside 08:30–11:00");
  assert.match(v.member, /competition/i);
});

test("more guests than one booking allows is refused", () => {
  // Not caught by the monthly allowance check, so a member with
  // headroom could sign in five, be charged for five, and have three
  // turned away at the first tee.
  const v = checkBooking({ slotId: "2026-08-30T09:00", guests: 4 }, rules, NOW);
  assert.ok(v, "4 guests, rule says 2");
  assert.match(v.member, /2 guests/);
});

test("too little notice is refused", () => {
  const soon = new Date(NOW.getTime() + 20 * 60e3);
  const hhmm = soon.toLocaleTimeString("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", minute: "2-digit" });
  const v = checkBooking({ slotId: `2026-08-26T${hhmm}`, guests: 0 }, rules, NOW);
  assert.ok(v, "20 minutes away, rule says 1 hour");
  assert.match(v.member, /notice/);
});

test("a time already gone is refused, and says so plainly", () => {
  const v = checkBooking({ slotId: "2026-08-26T07:00", guests: 0 }, rules, NOW);
  assert.ok(v);
  assert.match(v.member, /already passed/);
});

test("beyond the booking window is refused", () => {
  const v = checkBooking({ slotId: "2026-12-01T09:00", guests: 0 }, rules, NOW);
  assert.ok(v);
  assert.match(v.member, /42 days/);
});

test("an ordinary booking passes every rule", () => {
  // The counterweight. A rulebook that refuses everything is not a
  // safer agent, it is a broken one.
  assert.equal(checkBooking({ slotId: "2026-08-30T09:00", guests: 0 }, rules, NOW), undefined);
  assert.equal(checkBooking({ slotId: "2026-08-30T09:00", guests: 2 }, rules, NOW), undefined);
  assert.equal(checkBooking({ slotId: "2026-08-29T11:00", guests: 1 }, rules, NOW), undefined,
    "Saturday 11:00 is the moment the window ends");
});

// ═══ the supplier ═════════════════════════════════════════════════
test("where the club and the supplier disagree, the stricter wins", () => {
  // The allowance endpoint's limits were used without question. If the
  // sheet is edited to allow three live bookings, the club's rule
  // quietly stops applying and the agent still looks correct.
  const r = reconcileLimit(2, 3, "live bookings");
  assert.equal(r.limit, 2, "the club's rule is stricter and wins");
  assert.ok(r.disagreement, "and the disagreement is surfaced, not swallowed");
  assert.match(r.disagreement, /club's rules say 2.*tee sheet says 3/);
});

test("a stricter SUPPLIER also wins — this is not about who is authoritative", () => {
  // The supplier may know something the rulebook does not: a suspended
  // member, a seasonal restriction. Taking the minimum is safe in both
  // directions; taking "whoever we trust" is safe in neither.
  const r = reconcileLimit(6, 4, "guests per month");
  assert.equal(r.limit, 4);
  assert.ok(r.disagreement);
});

test("agreement is silent", () => {
  const r = reconcileLimit(2, 2, "live bookings");
  assert.equal(r.limit, 2);
  assert.equal(r.disagreement, undefined, "no noise when they agree");
});

test("a wider rulebook is honoured, not ignored", () => {
  // Proves the rules are READ. If someone widens the club's window to
  // eight weeks, the agent must follow.
  const wider: ClubRules = { ...rules, maxDaysAhead: 56 };
  assert.equal(checkBooking({ slotId: "2026-10-15T09:00", guests: 0 }, wider, NOW), undefined);
  assert.ok(checkBooking({ slotId: "2026-10-15T09:00", guests: 0 }, rules, NOW));
});

test("guest allowances come from fees.yaml, per category", () => {
  // booking-rules.yaml carries a flat 6, which is the full-member
  // figure. Comparing that against a category-aware supplier made every
  // midweek member look like a rule disagreement, when it was really
  // the rulebook being the less precise of two sources for one rule.
  assert.equal(rules.guestsPerMonthByCategory.full, 6);
  assert.equal(rules.guestsPerMonthByCategory.midweek, 4);
  assert.equal(rules.guestsPerMonthByCategory.country, 4);
  assert.equal(rules.guestsPerMonthByCategory.social, 0);

  // And a midweek member no longer produces a spurious disagreement.
  const r = reconcileLimit(rules.guestsPerMonthByCategory.midweek!, 4, "guests per month");
  assert.equal(r.disagreement, undefined);
});
