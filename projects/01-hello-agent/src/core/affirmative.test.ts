import { test } from "node:test";
import assert from "node:assert/strict";
import { isBareAffirmative } from "./confirmation.js";

// Guards checkEscalationRequest. Pure, so the boundary is testable
// without a model — which matters, because the bug it fixes cost a
// customer their cancellation and nineteen golden-set cases missed it.

test("bare affirmatives never reach the escalation classifier", () => {
  for (const t of ["yes", "Yes.", "YES!", "yes please", "yep", "yeah", "ok",
                   "okay", "sure", "fine", "do it", "go ahead", "confirm", " yes "]) {
    assert.equal(isBareAffirmative(t), true, `"${t}" should be treated as a bare answer`);
  }
});

test("an affirmative CARRYING a request still reaches the classifier", () => {
  // The anchors are the whole point. If any of these are swallowed, a
  // customer asking for a person gets silently ignored — which is a
  // worse bug than the one this guard fixes.
  for (const t of ["yes but can I speak to someone", "ok put me through",
                   "do it now and then get me a manager", "sure, is there a human available?",
                   "yes, transfer me"]) {
    assert.equal(isBareAffirmative(t), false, `"${t}" must still be classified`);
  }
});

test("ordinary content is not a bare affirmative", () => {
  for (const t of ["yes cancel it", "no thanks", "billy@example.com", "2 April 1979",
                   "this is useless, transfer me", ""]) {
    assert.equal(isBareAffirmative(t), false, `"${t}"`);
  }
});
