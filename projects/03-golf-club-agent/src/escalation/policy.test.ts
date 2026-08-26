// The phrase triggers. No model, no network.
//
// These are the triggers that must NOT depend on a model noticing, so
// they must not depend on a model to test either. Every phrasing here
// is one a member could plausibly type at 9pm.

import assert from "node:assert/strict";
import { test } from "node:test";
import { askedForAHuman, byId, promise, soundsFrustrated, triggers, vulnerability } from "./policy.js";

// ═══ requested: always honoured, never negotiated ══════════════════
test("a request for a human is recognised, however it is phrased", () => {
  for (const t of [
    "can I speak to a person please?",
    "I want to talk to someone",
    "get me a human",
    "put me through to a manager",
    "can I chat with staff",
    "real person please",
    "are you a bot?",
    "stop being a robot",
    "I'd rather speak to the pro",
  ]) {
    assert.ok(askedForAHuman(t), `should be a request for a human: "${t}"`);
  }
});

test("ordinary sentences about people are not requests for a human", () => {
  // A false positive costs one unnecessary handoff, so this is
  // deliberately loose — but not so loose that booking for a friend
  // triggers it.
  for (const t of [
    "book me and two guests",
    "the pro shop said it was fine",
    "my wife is playing too",
    "what time does the bar close?",
  ]) {
    assert.equal(askedForAHuman(t), false, `should NOT trigger: "${t}"`);
  }
});

// ═══ vulnerability: immediate and unconditional ════════════════════
test("bereavement is detected", () => {
  for (const t of [
    "my husband passed away last week",
    "my wife died in June",
    "I need to cancel my late father's membership",
    "we had the funeral on Tuesday",
    "I've been recently bereaved",
  ]) {
    assert.equal(vulnerability(t), "bereavement", `should be bereavement: "${t}"`);
  }
});

test("acute distress is detected and separated from bereavement", () => {
  for (const t of [
    "my husband is terminally ill",
    "I'm in hospital and can't play",
    "I can't cope with this",
  ]) {
    assert.equal(vulnerability(t), "distress", `should be distress: "${t}"`);
  }
});

test("a routine mention of health is NOT a vulnerability escalation", () => {
  // The threshold differs from the day-11 memory exclusion list, which
  // blocks the SAME categories from being stored. The club permits
  // advance buggy booking on medical grounds, so a member WILL mention
  // a knee — and that is a buggy request, not a person in difficulty.
  for (const t of [
    "I've had a knee replacement so I'll need a buggy",
    "my back is playing up, can I get a buggy",
    "I had surgery last year",
  ]) {
    assert.equal(vulnerability(t), undefined, `should NOT escalate: "${t}"`);
  }
});

// ═══ frustration ═══════════════════════════════════════════════════
test("frustration is recognised", () => {
  for (const t of [
    "this is ridiculous, I've been a member for 15 years",
    "that's not good enough",
    "I'm fed up with this",
    "what?? that can't be right",
    "absolute joke",
  ]) {
    assert.ok(soundsFrustrated(t), `should read as frustrated: "${t}"`);
  }
});

test("frustration alone is not a trigger — it needs a refusal beside it", () => {
  // Enforced in the loop, not here: soundsFrustrated only ever runs
  // when refusedLastTurn is set. A member having a bad day is not a
  // handoff; a member having a bad day BECAUSE we just said no is.
  assert.ok(soundsFrustrated("this is ridiculous"));
  assert.equal(byId("refused_and_frustrated")?.source, "policy");
  assert.equal(byId("refused_and_frustrated")?.team, "pro_shop");
  assert.equal(byId("refused_and_frustrated")?.urgency, "immediate");
});

// ═══ the policy itself ═════════════════════════════════════════════
test("every trigger routes somewhere and names what was missing", () => {
  // `missing` is the improvement loop's only input. A trigger without
  // one records that the agent gave up and not why.
  for (const t of triggers) {
    assert.ok(t.team.length > 0, `${t.id} has no team`);
    assert.ok(t.member_message.trim().length > 20, `${t.id} has no member message`);
    assert.ok(
      ["none", "knowledge", "tool", "policy", "judgement", "out_of_scope"].includes(t.missing),
      `${t.id} has an unknown 'missing': ${t.missing}`,
    );
  }
});

test("all four sources are covered, and vulnerability is immediate", () => {
  const sources = new Set(triggers.map((t) => t.source));
  for (const s of ["requested", "emotional", "policy", "capability"]) {
    assert.ok(sources.has(s as never), `no trigger for source "${s}"`);
  }
  assert.equal(byId("bereavement")?.urgency, "immediate");
  assert.equal(byId("distress")?.urgency, "immediate");
});

test("the promise to the member depends on the clock", () => {
  // URGENCY IS A PROMISE, NOT A QUEUE PRIORITY. The club is staffed
  // 08:00–16:30 and the PRD's premise is out-of-hours demand, so most
  // escalations are raised when nobody is there.
  const nightTime = new Date("2026-08-26T21:00:00+10:00");
  const workTime = new Date("2026-08-26T10:00:00+10:00");
  assert.notEqual(promise("immediate", nightTime), promise("immediate", workTime));
  assert.match(promise("immediate", nightTime), /tomorrow/);
  assert.match(promise("immediate", workTime), /hour/);
});
