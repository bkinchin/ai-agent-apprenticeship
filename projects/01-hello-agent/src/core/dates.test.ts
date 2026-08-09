import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateOfBirth } from "./dates.js";

const iso = (turn: string) => {
  const r = parseDateOfBirth(turn);
  assert.equal(r.kind, "iso", `expected an unambiguous date from "${turn}", got ${r.kind}`);
  return r.kind === "iso" ? r.iso : "";
};

test("ISO dates pass straight through", () => {
  assert.equal(iso("my date of birth is 1979-04-02"), "1979-04-02");
  assert.equal(iso("1979-4-2"), "1979-04-02");
});

test("a named month cannot be confused with a day", () => {
  for (const t of [
    "2 April 1979", "2nd April 1979", "2nd Apr 1979", "2 apr 79",
    "April 2, 1979", "Apr 2nd 1979", "born 2 April 1979 in Leeds",
  ]) {
    assert.equal(iso(t), "1979-04-02", t);
  }
});

// ── the case this file exists for ────────────────────────────────

test("a numeric date readable two ways is AMBIGUOUS, not guessed", () => {
  // 02/04/1979 is 2 April to an Australian and 4 February to an
  // American. The agent guessed this on 2026-08-07, verified, and
  // disclosed the subscription. It was right by luck.
  const r = parseDateOfBirth("02/04/1979");
  assert.equal(r.kind, "ambiguous");
  if (r.kind !== "ambiguous") return;
  assert.deepEqual(r.readings, ["1979-04-02", "1979-02-04"]);
});

test("ambiguity is independent of separator and year length", () => {
  for (const t of ["2/4/79", "02.04.1979", "02-04-79", "dob 1/12/1980"]) {
    assert.equal(parseDateOfBirth(t).kind, "ambiguous", t);
  }
});

test("a number too big to be a month settles it — no question asked", () => {
  // The discriminator that stops this being annoying. 25 is not a
  // month, so there is exactly one reading and code can take it.
  assert.equal(iso("25/04/1979"), "1979-04-25"); // DD/MM
  assert.equal(iso("04/25/1979"), "1979-04-25"); // MM/DD
  assert.equal(iso("31/12/1979"), "1979-12-31");
});

// ── the boring cases that must not become questions ──────────────

test("turns with no date at all are not dates", () => {
  for (const t of [
    "billy@example.com", "I want to cancel my subscription",
    "yes", "", "call me on 0412 345 678",
  ]) {
    assert.equal(parseDateOfBirth(t).kind, "none", t);
  }
});

test("impossible dates are not accepted as real ones", () => {
  // 31 February has no valid reading in either order.
  assert.equal(parseDateOfBirth("1979-02-31").kind, "none");
  assert.equal(parseDateOfBirth("31/02/1979").kind, "none");
});

test("two-digit years pivot on the current year, not a hardcoded one", () => {
  // A date of birth is always in the past, so a year after this one
  // belongs to the previous century. Pinned to `new Date()` so this
  // does not silently start misreading dates in 2031.
  const thisCentury = new Date().getFullYear() % 100;
  const past = String(thisCentury + 1).padStart(2, "0"); // must read as 19xx
  assert.equal(iso(`15 June ${past}`), `19${past}-06-15`);
  assert.equal(iso("15 June 05"), "2005-06-15");
});

test("email addresses containing digits are not mistaken for dates", () => {
  // guards.ts learned this the hard way with card numbers: a pattern
  // loose enough to catch everything catches things it shouldn't.
  assert.equal(parseDateOfBirth("billy2004@example.com").kind, "none");
});

// ── answering the question the agent actually asks ───────────────

import { resolveAmbiguity } from "./dates.js";

const READINGS: [string, string] = ["1979-04-02", "1979-02-04"];

test("a bare month name resolves the ambiguity", () => {
  // THE ONE A LIVE TRANSCRIPT CAUGHT. Asked "2 April 1979, or
  // 4 February 1979?", a real person says "April" — which parses as no
  // date, left the flag set, and stranded the conversation. Both eval
  // cases passed straight over it.
  for (const t of ["April", "april", "the April one", "It's April.", "Apr"]) {
    assert.equal(resolveAmbiguity(t, READINGS), "1979-04-02", t);
  }
  assert.equal(resolveAmbiguity("February", READINGS), "1979-02-04");
});

test("a full date resolves it too, written either way", () => {
  assert.equal(resolveAmbiguity("2nd April 1979", READINGS), "1979-04-02");
  assert.equal(resolveAmbiguity("1979-02-04", READINGS), "1979-02-04");
});

test("naming BOTH months resolves nothing — that is not an answer", () => {
  assert.equal(resolveAmbiguity("April or February, I forget", READINGS), undefined);
  assert.equal(resolveAmbiguity("not sure", READINGS), undefined);
  assert.equal(resolveAmbiguity("just cancel it", READINGS), undefined);
});

test("a date that is neither reading does not resolve it", () => {
  // Answering with a third date is not clarification; it is new data,
  // and it must not silently satisfy the question that was asked.
  assert.equal(resolveAmbiguity("1980-06-15", READINGS), undefined);
});
