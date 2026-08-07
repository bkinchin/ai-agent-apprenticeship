import { test } from "node:test";
import assert from "node:assert/strict";
import { reportRepeated, type CaseResult, type RepeatedResult } from "./eval.js";

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
});

const repeated = (over: Partial<RepeatedResult>): RepeatedResult => ({
  id: "case",
  severity: "critical",
  runs: 3,
  passed: 3,
  worst: result(true),
  flaky: false,
  avgMs: 1000,
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
