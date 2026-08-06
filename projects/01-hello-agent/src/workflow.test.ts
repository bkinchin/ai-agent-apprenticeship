import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, STAGE_TOOLS, type TaskState } from "./workflow.js";

const empty: TaskState = { subscriptionInspected: false };

const verified: TaskState = {
  verifiedCustomerId: "CUST-1029",
  subscriptionInspected: true,
};

const readyToCancel: TaskState = {
  verifiedCustomerId: "CUST-1029",
  subscriptionInspected: true,
  confirmedAction: { tool: "cancel_subscription", customerId: "CUST-1029" },
};

// ── the happy path ───────────────────────────────────────────────

test("the intended route is legal at each step", () => {
  assert.ok(canTransition("GREETING", "VERIFICATION", empty).ok);
  assert.ok(canTransition("VERIFICATION", "INSPECTION", verified).ok);
  assert.ok(canTransition("INSPECTION", "CONFIRMATION", verified).ok);
  assert.ok(canTransition("CONFIRMATION", "EXECUTION", readyToCancel).ok);
  assert.ok(canTransition("EXECUTION", "COMPLETE", readyToCancel).ok);
});

// ── you cannot skip ahead ────────────────────────────────────────

test("cannot jump straight to EXECUTION, however complete the state", () => {
  const g = canTransition("GREETING", "EXECUTION", readyToCancel);
  assert.equal(g.ok, false);
});

test("cannot skip verification", () => {
  const g = canTransition("GREETING", "INSPECTION", empty);
  assert.equal(g.ok, false);
});

// ── preconditions ────────────────────────────────────────────────

test("unverified customer cannot reach INSPECTION", () => {
  const g = canTransition("VERIFICATION", "INSPECTION", empty);
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /not verified/);
});

test("cannot confirm before inspecting the subscription", () => {
  const g = canTransition("INSPECTION", "CONFIRMATION", {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: false,
  });
  assert.equal(g.ok, false);
});

test("cannot execute without a confirmation", () => {
  const g = canTransition("CONFIRMATION", "EXECUTION", verified);
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /No confirmed action/);
});

test("confirmation for a DIFFERENT customer does not count", () => {
  const g = canTransition("CONFIRMATION", "EXECUTION", {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: true,
    confirmedAction: { tool: "cancel_subscription", customerId: "CUST-2044" },
  });
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /different customer/);
});

// ── no way back, and no way out of the end ───────────────────────

test("cannot go backwards", () => {
  assert.equal(canTransition("EXECUTION", "CONFIRMATION", readyToCancel).ok, false);
});

test("COMPLETE is terminal", () => {
  assert.equal(canTransition("COMPLETE", "EXECUTION", readyToCancel).ok, false);
});

// ── the capability itself ────────────────────────────────────────

test("cancel_subscription exists in exactly one stage", () => {
  const stages = Object.entries(STAGE_TOOLS)
    .filter(([, tools]) => tools.includes("cancel_subscription"))
    .map(([stage]) => stage);
  assert.deepEqual(stages, ["EXECUTION"]);
});

test("no write tool is reachable before EXECUTION", () => {
  for (const stage of ["GREETING", "VERIFICATION", "INSPECTION", "CONFIRMATION"] as const) {
    assert.ok(
      !STAGE_TOOLS[stage].includes("cancel_subscription"),
      `${stage} must not expose cancel_subscription`,
    );
  }
});
