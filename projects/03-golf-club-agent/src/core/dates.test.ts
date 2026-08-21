// The date guard, tested without a model or a server.
//
// Project 03 had no unit tests at all — every check needed a running
// tee sheet, an API key, or both, which means the cheapest feedback
// loop in the project was also the only one that did not exist.
//
// This is the natural first one because the bug it guards was real and
// silent: asked for "Saturday the 29th of August" the model called the
// tee sheet for 2025-08-29 — last year, and a Friday. The sheet
// answered honestly about a date nobody asked about, and the member was
// told "no free slots Saturday morning, 29 August".
//
// Nothing lied. Every component did its job on the wrong input.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dateProblem } from "./agent.js";

// Fixed "now" so these do not start failing in six weeks' time. A test
// whose result depends on the day it runs is a test that will one day
// fail for a reason nobody can reproduce.
const NOW = new Date("2026-08-21T10:00:00+10:00");

test("accepts a date inside the six-week window", () => {
  assert.equal(dateProblem("2026-08-29", NOW), undefined);
  assert.equal(dateProblem("2026-08-21", NOW), undefined, "today is bookable");
});

test("rejects the wrong-year guess that started this", () => {
  const why = dateProblem("2025-08-29", NOW);
  assert.ok(why, "a date last year must be refused");
  assert.match(why, /past/);
});

test("rejects yesterday", () => {
  assert.match(dateProblem("2026-08-20", NOW) ?? "", /past/);
});

test("enforces the club's six-week booking window", () => {
  // booking-rules.yaml: members may book up to six weeks ahead.
  assert.equal(dateProblem("2026-10-01", NOW), undefined, "41 days is inside");
  assert.match(dateProblem("2026-10-05", NOW) ?? "", /six weeks/, "45 days is outside");
});

test("rejects things that are not dates", () => {
  for (const junk of ["saturday", "29-08-2026", "2026-8-9", "", "2026-08-29T09:20"]) {
    assert.ok(dateProblem(junk, NOW), `"${junk}" should be refused`);
  }
});

test("the message names the date it rejected", () => {
  // A refusal the model cannot act on is a dead end. It must be able to
  // see WHICH date was wrong, or it will send the same one again.
  assert.match(dateProblem("2025-08-29", NOW) ?? "", /2025-08-29/);
});
