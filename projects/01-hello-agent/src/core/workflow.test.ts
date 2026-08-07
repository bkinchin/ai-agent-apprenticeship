import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, nextStages, restart, STAGE_TOOLS, type TaskState } from "./workflow.js";

const empty: TaskState = { subscriptionInspected: false };

const verified: TaskState = {
  verifiedCustomerId: "CUST-1029",
  subscriptionInspected: true,
  retentionOffered: true,
  retentionDeclined: true,
};

const readyToCancel: TaskState = {
  verifiedCustomerId: "CUST-1029",
  subscriptionInspected: true,
  retentionOffered: true,
  retentionDeclined: true,
  confirmedAction: { tool: "cancel_subscription", customerId: "CUST-1029" },
};

const executed: TaskState = {
  ...readyToCancel,
  executedAction: { tool: "cancel_subscription", customerId: "CUST-1029" },
};

// ── the happy path ───────────────────────────────────────────────

test("the intended route is legal at each step", () => {
  assert.ok(canTransition("GREETING", "VERIFICATION", empty).ok);
  assert.ok(canTransition("VERIFICATION", "INSPECTION", verified).ok);
  assert.ok(canTransition("INSPECTION", "RETENTION", verified).ok);
  assert.ok(canTransition("RETENTION", "CONFIRMATION", verified).ok);
  assert.ok(canTransition("CONFIRMATION", "EXECUTION", readyToCancel).ok);
  assert.ok(canTransition("EXECUTION", "COMPLETE", executed).ok);
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

test("cannot confirm before retention has been offered", () => {
  const g = canTransition("RETENTION", "CONFIRMATION", {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: true,
    retentionOffered: false,
  });
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /Retention has not been offered/);
});

test("OFFERING retention is not the same as the customer DECLINING it", () => {
  const g = canTransition("RETENTION", "CONFIRMATION", {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: true,
    retentionOffered: true,
    retentionDeclined: false,
  });
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /not declined/);
});

test("cannot reach RETENTION before inspecting the subscription", () => {
  const g = canTransition("INSPECTION", "RETENTION", {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: false,
  });
  assert.equal(g.ok, false);
});

test("accepting the offer is a valid ending — RETENTION goes straight to COMPLETE", () => {
  const accepted: TaskState = {
    verifiedCustomerId: "CUST-1029",
    subscriptionInspected: true,
    retentionOffered: true,
    executedAction: { tool: "apply_retention", customerId: "CUST-1029" },
  };
  assert.ok(canTransition("RETENTION", "COMPLETE", accepted).ok);
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

test("cannot report COMPLETE if nothing was executed", () => {
  const g = canTransition("EXECUTION", "COMPLETE", readyToCancel);
  assert.equal(g.ok, false);
  assert.match((g as { reason: string }).reason, /Nothing was executed/);
});

// ── escape hatches ───────────────────────────────────────────────

test("escalation is reachable from every non-terminal stage", () => {
  for (const from of ["GREETING", "VERIFICATION", "INSPECTION", "RETENTION", "CONFIRMATION", "EXECUTION"] as const) {
    assert.ok(
      canTransition(from, "ESCALATED", empty).ok,
      `must be able to escalate from ${from}`,
    );
  }
});

test("escalation needs no preconditions — an empty state still works", () => {
  assert.ok(canTransition("GREETING", "ESCALATED", empty).ok);
});

test("ESCALATED is terminal", () => {
  assert.equal(canTransition("ESCALATED", "EXECUTION", readyToCancel).ok, false);
  assert.equal(canTransition("ESCALATED", "VERIFICATION", readyToCancel).ok, false);
});

test("ESCALATED exposes no tools", () => {
  assert.deepEqual(STAGE_TOOLS.ESCALATED, []);
});

test("restart() discards verification — you cannot stay verified as the wrong person", () => {
  const fresh = restart();
  assert.equal(fresh.verifiedCustomerId, undefined);
  assert.equal(fresh.confirmedAction, undefined);
  assert.equal(fresh.subscriptionInspected, false);
});

test("after restart, EXECUTION is unreachable again", () => {
  const fresh = restart();
  assert.equal(canTransition("CONFIRMATION", "EXECUTION", fresh).ok, false);
});

// ── the capability itself ────────────────────────────────────────

test("cancel_subscription exists in exactly one stage", () => {
  const stages = Object.entries(STAGE_TOOLS)
    .filter(([, tools]) => tools.includes("cancel_subscription"))
    .map(([stage]) => stage);
  assert.deepEqual(stages, ["EXECUTION"]);
});

test("no write tool is reachable before EXECUTION", () => {
  for (const stage of ["GREETING", "VERIFICATION", "INSPECTION", "RETENTION", "CONFIRMATION"] as const) {
    assert.ok(
      !STAGE_TOOLS[stage].includes("cancel_subscription"),
      `${stage} must not expose cancel_subscription`,
    );
  }
});

// ── branching ────────────────────────────────────────────────────

test("RETENTION branches: decline leads to CONFIRMATION, accept to COMPLETE", () => {
  assert.deepEqual(nextStages("RETENTION"), ["CONFIRMATION", "COMPLETE"]);
});

test("nextStages excludes escape hatches — otherwise everything auto-escalates", () => {
  for (const s of ["GREETING", "VERIFICATION", "INSPECTION", "RETENTION", "CONFIRMATION", "EXECUTION"] as const) {
    assert.ok(!nextStages(s).includes("ESCALATED"), `${s} must not drift into ESCALATED`);
  }
});
