import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, listRules, loadPolicy, type PolicyContext } from "./policy.js";

const policy = loadPolicy();

const stranger: PolicyContext = { verified: false, flags: {} };
const verified: PolicyContext = { verified: true, flags: {} };
const verifiedAndOffered: PolicyContext = {
  verified: true,
  flags: { retentionOffered: true },
};

// ── the policy file itself ───────────────────────────────────────

test("both policy files are valid and load", () => {
  assert.ok(policy.versions.safety > 0);
  assert.ok(policy.versions.commercial > 0);
  assert.ok(policy.rules.length >= 2);
});

test("safety rules are always evaluated before commercial ones", () => {
  const firstCommercial = policy.rules.findIndex((r) => r.tier === "commercial");
  const lastSafety = policy.rules.map((r) => r.tier).lastIndexOf("safety");
  assert.ok(lastSafety < firstCommercial, "safety must come first");
});

test("commercial policy cannot permit what safety denies", () => {
  // A stranger with every commercial flag satisfied is still refused,
  // because the safety rule is reached first.
  const d = evaluate(policy, "cancel_subscription", {
    verified: false,
    flags: { retentionOffered: true },
  });
  assert.equal(d.allow, false);
  assert.equal((d as { tier: string }).tier, "safety");
});

test("every rule has a rationale — if you can't say why, question the rule", () => {
  for (const r of policy.rules) {
    assert.ok(r.rationale.trim().length > 20, `${r.id} needs a real rationale`);
  }
});

// ── verify before disclosure ─────────────────────────────────────

test("a stranger cannot read a subscription", () => {
  const d = evaluate(policy, "get_subscription", stranger);
  assert.equal(d.allow, false);
  assert.equal((d as { ruleId: string }).ruleId, "verify-before-disclosure");
});

test("a stranger cannot cancel a subscription", () => {
  assert.equal(evaluate(policy, "cancel_subscription", stranger).allow, false);
});

test("looking someone up is not gated — only disclosure is", () => {
  assert.equal(evaluate(policy, "find_customer", stranger).allow, true);
});

test("a verified customer can read their subscription", () => {
  assert.equal(evaluate(policy, "get_subscription", verified).allow, true);
});

// ── retention before cancellation ────────────────────────────────

test("verified is not enough to cancel — retention must have been offered", () => {
  const d = evaluate(policy, "cancel_subscription", verified);
  assert.equal(d.allow, false);
  assert.equal((d as { ruleId: string }).ruleId, "retention-before-cancel");
});

test("verified AND offered retention can cancel", () => {
  assert.equal(evaluate(policy, "cancel_subscription", verifiedAndOffered).allow, true);
});

// ── decisions are traceable ──────────────────────────────────────

test("every decision carries both policy versions", () => {
  const d = evaluate(policy, "cancel_subscription", stranger);
  assert.deepEqual(d.versions, policy.versions);
});

test("listRules answers \"what are the rules?\" in one place", () => {
  const listed = listRules(policy);
  for (const r of policy.rules) assert.match(listed, new RegExp(r.id));
});

test("a denial explains itself in words a customer could hear", () => {
  const d = evaluate(policy, "get_subscription", stranger);
  assert.match((d as { message: string }).message, /confirm your identity/i);
});
