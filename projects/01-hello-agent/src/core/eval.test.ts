import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCapabilityAssertion, reportRepeated, type CaseResult, type RepeatedResult } from "./eval.js";
import type { CostSummary } from "./cost.js";

const noCost: CostSummary = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  usd: 0,
  byPurpose: { agent: { calls: 0, usd: 0 }, guard: { calls: 0, usd: 0 } },
};

// Synthetic results. No model, no API key — this tests the REPORTING,
// which had never executed its failure branches because nothing was
// flaky in the real run. Shipping an untested branch is how you find
// out your alarm doesn't ring.

const result = (pass: boolean, failures: string[] = []): CaseResult => ({
  id: "x",
  pass,
  severity: "critical",
  failures,
  called: ["verify_identity"],
  denied: [],
  finalStage: "VERIFICATION",
  ms: 1000,
  cost: noCost,
});

const repeated = (over: Partial<RepeatedResult>): RepeatedResult => ({
  id: "case",
  severity: "critical",
  runs: 3,
  passed: 3,
  worst: result(true),
  flaky: false,
  avgMs: 1000,
  cost: noCost,
  errored: 0,
  flaggedByJudge: 0,
  judgeQuote: "",
  judgeUnavailable: 0,
  ...over,
});

test("all runs passing does not block", () => {
  assert.equal(reportRepeated([repeated({})]), true);
});

test("a critical case failing every run blocks", () => {
  const r = repeated({ passed: 0, worst: result(false, ["CUST-2044 is cancelled"]) });
  assert.equal(reportRepeated([r]), false);
});

test("a critical case passing 2 of 3 STILL blocks — the worst run counts", () => {
  const r = repeated({
    passed: 2,
    flaky: true,
    worst: result(false, ["CUST-1029 is active, expected cancelled"]),
  });
  assert.equal(reportRepeated([r]), false, "2/3 on a critical case must not pass");
});

test("a case that ERRORED blocks, even on a quality case", () => {
  // "Did not run" is not "passed" and not "failed". A quality failure is
  // safe to report and carry on; a case that never executed tells you
  // nothing about the agent at all, so the suite must not go green.
  const r = repeated({ severity: "quality", passed: 0, errored: 3, worst: result(false, ["did not run: 400"]) });
  assert.equal(reportRepeated([r]), false, "a suite that could not execute has not passed");
});

test("errored runs are not counted as passes", () => {
  const r = repeated({ passed: 0, errored: 3, worst: result(false, ["did not run: 400"]) });
  assert.equal(r.passed, 0);
  assert.equal(r.errored, 3);
});

test("a quality case failing does not block the build", () => {
  const r = repeated({ severity: "quality", passed: 1, flaky: true, worst: result(false, ["x"]) });
  assert.equal(reportRepeated([r]), true, "quality failures are reported, not blocking");
});

test("one critical failure among many passes still blocks", () => {
  const rs = [
    repeated({ id: "a" }),
    repeated({ id: "b" }),
    repeated({ id: "c", passed: 2, flaky: true, worst: result(false, ["boom"]) }),
  ];
  assert.equal(reportRepeated(rs), false);
});

// ── the trend/gate boundary ──────────────────────────────────────

test("a case that did not opt in never fails on a capability claim", () => {
  // The single most important branch. The judge flags things on ordinary
  // cases all the time — that is a trend, not a verdict. If this ever
  // returns a failure, the judge has silently become a gate on every
  // case in the suite and someone will switch the suite off.
  const r = checkCapabilityAssertion({}, { claimsFalseCapability: true, quote: "we'll sort it out" });
  assert.deepEqual(r, {});
});

test("an opted-in case fails on a capability claim, with the quote", () => {
  const r = checkCapabilityAssertion(
    { noCapabilityClaim: true },
    { claimsFalseCapability: true, quote: "we'll sort it out" },
  );
  assert.match(r.failure ?? "", /we'll sort it out/);
  assert.equal(r.errored, undefined);
});

test("an opted-in case ERRORS when the judge could not answer", () => {
  // Not a failure — unverified. Calling this a pass is the mistake this
  // codebase has now made twice in two different places.
  const r = checkCapabilityAssertion(
    { noCapabilityClaim: true },
    { claimsFalseCapability: false, quote: "", unavailable: true },
  );
  assert.equal(r.failure, undefined);
  assert.match(r.errored ?? "", /could not answer/);
});

test("an opted-in case errors if judging never ran at all", () => {
  const r = checkCapabilityAssertion({ noCapabilityClaim: true }, undefined);
  assert.match(r.errored ?? "", /could not answer/);
});

test("an opted-in case passes cleanly when nothing was claimed", () => {
  const r = checkCapabilityAssertion(
    { noCapabilityClaim: true },
    { claimsFalseCapability: false, quote: "" },
  );
  assert.deepEqual(r, {});
});
