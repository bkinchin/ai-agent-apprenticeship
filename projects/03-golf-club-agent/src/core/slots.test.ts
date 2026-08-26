// Both guards, found by a member typing at the agent.

import assert from "node:assert/strict";
import { test } from "node:test";
import { closedFor, weekdayNamed, weekdayOf, type Closure } from "./slots.js";

const COMP: Closure[] = [
  { day: "saturday", from: "08:30", to: "11:00", reason: "Club competition" },
];

// ═══ the closed window ════════════════════════════════════════════
test("a Saturday competition slot is closed to general booking", () => {
  // Day 9 found this rule being ANSWERED wrongly and fixed it in the
  // corpus. Nothing enforced it in the booking path, so the agent would
  // explain the sheet was shut and then book you into it — day 9's own
  // highest-blast-radius failure surviving the fix meant to prevent it.
  for (const t of ["08:30", "09:00", "09:20", "10:59"]) {
    assert.ok(closedFor(`2026-08-29T${t}`, COMP), `${t} Saturday should be closed`);
  }
});

test("the boundaries are half-open — 11:00 is bookable", () => {
  assert.equal(closedFor("2026-08-29T08:20", COMP), undefined, "before the window");
  assert.equal(closedFor("2026-08-29T11:00", COMP), undefined, "the window ends AT 11:00");
  assert.equal(closedFor("2026-08-29T11:10", COMP), undefined, "after it");
});

test("the same time on another day is fine", () => {
  assert.equal(closedFor("2026-08-30T09:00", COMP), undefined, "Sunday");
  assert.equal(closedFor("2026-08-27T09:00", COMP), undefined, "Thursday");
});

test("the closure names its reason, so a member can be told why", () => {
  assert.equal(closedFor("2026-08-29T09:00", COMP)?.reason, "Club competition");
});

test("weekdays are computed in UTC so a date cannot slip a day", () => {
  // A date-only string has no timezone. Parsing it as local midnight
  // shifts the weekday west of the parse — an agent in Sydney calling a
  // Saturday a Friday, and missing the closure entirely.
  assert.equal(weekdayOf("2026-08-29"), "saturday");
  assert.equal(weekdayOf("2026-08-30"), "sunday");
  assert.equal(weekdayOf("2026-08-27"), "thursday");
});

// ═══ the weekday the member named ═════════════════════════════════
test("a mistyped weekday is still recognised", () => {
  // "Can I book for staturday 9am" was resolved by the model to Sunday
  // 30 August. Ordinary human sloppiness is the input class that has
  // found defects all week, and you cannot enumerate the ways a word
  // can be mistyped — hence edit distance rather than a pattern.
  assert.equal(weekdayNamed("Can I book for staturday 9 am"), "saturday");
  assert.equal(weekdayNamed("anything on saterday?"), "saturday");
  assert.equal(weekdayNamed("how about thurdsay"), "thursday");
  assert.equal(weekdayNamed("wendsday morning please"), "wednesday");
});

test("an exact weekday is recognised", () => {
  assert.equal(weekdayNamed("book me saturday at 9"), "saturday");
  assert.equal(weekdayNamed("SUNDAY please"), "sunday");
});

test("words that merely resemble a weekday do not count", () => {
  // A false positive here refuses a date the member did give, which is
  // worse than the bug being fixed.
  for (const t of [
    "book me tomorrow at 9",
    "someday next month",
    "is there a sundeck?",
    "what time does the bar close",
  ]) {
    assert.equal(weekdayNamed(t), undefined, `should not name a weekday: "${t}"`);
  }
});
