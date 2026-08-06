import { test } from "node:test";
import assert from "node:assert/strict";
import { auditLog, runTool, VERIFY_FAILED, type ToolContext, type World } from "./executor.js";
import { loadPolicy } from "./policy.js";
import type { TaskState } from "./workflow.js";

const policy = loadPolicy();

function fresh(): ToolContext {
  const world: World = {
    customers: [{ id: "CUST-1029", email: "billy@example.com", name: "Billy K", dob: "1979-04-02" }],
    subscriptions: [{ customerId: "CUST-1029", plan: "PRO", priceGbp: 49, status: "active" }],
  };
  const state: TaskState = { subscriptionInspected: false };
  return { policy, state, world };
}

test("an unverified caller cannot read a subscription", () => {
  const ctx = fresh();
  const out = runTool("get_subscription", { customerId: "CUST-1029" }, ctx);
  assert.match(out, /Not permitted/);
  assert.equal(ctx.state.subscriptionInspected, false);
});

test("an unverified caller cannot cancel — and nothing changes", () => {
  const ctx = fresh();
  runTool("cancel_subscription", { customerId: "CUST-1029" }, ctx);
  assert.equal(ctx.world.subscriptions[0]!.status, "active");
});

// ── no enumeration ───────────────────────────────────────────────

test("a wrong date of birth does not verify", () => {
  const ctx = fresh();
  runTool("verify_identity", { email: "billy@example.com", dateOfBirth: "1980-01-01" }, ctx);
  assert.equal(ctx.state.verifiedCustomerId, undefined);
});

test("wrong DOB and unknown email are BYTE-IDENTICAL", () => {
  const wrongDob = runTool(
    "verify_identity",
    { email: "billy@example.com", dateOfBirth: "1980-01-01" },
    fresh(),
  );
  const noAccount = runTool(
    "verify_identity",
    { email: "nobody@example.com", dateOfBirth: "1980-01-01" },
    fresh(),
  );
  assert.equal(wrongDob, noAccount);
  assert.equal(wrongDob, VERIFY_FAILED);
});

test("a failed verification leaks no name, no id, no email", () => {
  const out = runTool(
    "verify_identity",
    { email: "billy@example.com", dateOfBirth: "1980-01-01" },
    fresh(),
  );
  for (const secret of ["Billy", "CUST-1029", "billy@example.com"]) {
    assert.ok(!out.includes(secret), `failure message leaked "${secret}"`);
  }
});

test("there is no tool that looks a customer up without verifying them", () => {
  const ctx = fresh();
  assert.match(runTool("find_customer", { email: "billy@example.com" }, ctx), /Unknown tool/);
  assert.match(
    runTool("verify_customer", { customerId: "CUST-1029", dateOfBirth: "1979-04-02" }, ctx),
    /Unknown tool/,
  );
});

test("verified is still not enough to cancel — retention comes first", () => {
  const ctx = fresh();
  runTool("verify_identity", { email: "billy@example.com", dateOfBirth: "1979-04-02" }, ctx);
  const out = runTool("cancel_subscription", { customerId: "CUST-1029" }, ctx);
  assert.match(out, /Not permitted/);
  assert.equal(ctx.world.subscriptions[0]!.status, "active");
});

test("verified + retention offered can cancel", () => {
  const ctx = fresh();
  runTool("verify_identity", { email: "billy@example.com", dateOfBirth: "1979-04-02" }, ctx);
  runTool("offer_retention", { customerId: "CUST-1029" }, ctx);
  runTool("cancel_subscription", { customerId: "CUST-1029" }, ctx);
  assert.equal(ctx.world.subscriptions[0]!.status, "cancelled");
});

test("bad arguments never reach the implementation", () => {
  const ctx = fresh();
  const out = runTool("get_subscription", { customerId: "not-an-id" }, ctx);
  assert.match(out, /Invalid arguments/);
});

test("every call is audited, denials included", () => {
  const before = auditLog.length;
  const ctx = fresh();
  runTool("cancel_subscription", { customerId: "CUST-1029" }, ctx);
  const entry = auditLog[auditLog.length - 1]!;
  assert.equal(auditLog.length, before + 1);
  assert.equal(entry.decision, "denied");
  assert.equal(entry.tool, "cancel_subscription");
  assert.ok(entry.ruleId, "a denial must record which rule denied it");
  assert.ok(entry.policyVersions, "and which policy version was in force");
});
