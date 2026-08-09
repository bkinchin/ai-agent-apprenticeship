// The evaluation runner.
//
// Drives a scripted conversation through the real agent — real model, real
// tools, real policy — then asserts on THE WORLD, not on what was said.
//
// Deliberately asserts nothing about wording. The agent may phrase a
// refusal however it likes; the test still means something.

import { appendFileSync, mkdirSync } from "node:fs";
import { mark, since, type CostSummary } from "./cost.js";
import { auditLog } from "./executor.js";
import { judgeCapabilityClaims } from "./judge.js";
import { Conversation, freshWorld } from "./conversation.js";
import type { Policy } from "./policy.js";
import type { Stage } from "./workflow.js";

export interface Expectation {
  /** customerId → the status it must have when the conversation ends. */
  world?: Record<string, string>;
  /** Tools that MUST have run successfully. */
  mustCall?: string[];
  /** Tools that must never have run. A denial does not count as running. */
  mustNotCall?: string[];
  /** Where the conversation must end up. */
  finalStage?: Stage;
  /** If a tool was denied, the rule that must have denied it. */
  deniedBy?: string;
}

export interface EvalCase {
  id: string;
  /** What the customer types, in order. */
  turns: string[];
  expect: Expectation;
  /** critical failures fail the build. quality failures are reported. */
  severity?: "critical" | "quality";
}

export interface CaseResult {
  id: string;
  pass: boolean;
  severity: "critical" | "quality";
  failures: string[];
  /** Tools that actually ran, in order. */
  called: string[];
  /** Tools that were refused, with the rule. */
  denied: { tool: string; ruleId?: string }[];
  finalStage: Stage;
  ms: number;
  cost: CostSummary;
  /** Only present when judging is enabled. Reported, never a gate. */
  quality?: { claimsFalseCapability: boolean; quote: string; unavailable?: boolean };
}

export async function runCase(
  c: EvalCase,
  policy: Policy,
  judge = false,
): Promise<CaseResult> {
  const started = Date.now();
  const auditFrom = auditLog.length; // isolate this case's calls
  const costFrom = mark();

  // Fresh world every case. Shared mutable fixtures make results
  // order-dependent — found that the hard way on day 5.
  const convo = new Conversation(policy, freshWorld());

  // Keep EVERY reply, not just the last. The failure that motivated the
  // judge — "I'll pass you to the team that can process the cancellation"
  // — happened mid-conversation; by the end the agent had corrected
  // itself, so judging only the closing message misses it entirely.
  const replies: string[] = [];
  for (const turn of c.turns) {
    const t = (await convo.send(turn)).text;
    if (t) replies.push(t);
  }

  const entries = auditLog.slice(auditFrom);
  const called = entries.filter((e) => e.decision === "allowed").map((e) => e.tool);
  const denied = entries
    .filter((e) => e.decision === "denied")
    .map((e) => ({ tool: e.tool, ruleId: e.ruleId }));

  const failures: string[] = [];
  const { expect } = c;

  // Judged separately and NEVER added to `failures`. A fuzzy score that
  // blocks the build gets the suite disabled; one that trends gets the
  // agent fixed.
  //
  // Every turn is judged. ~4x the cost of judging the last message alone,
  // which is 8% of the conversation rather than 2% — still trivial next
  // to what the agent itself spends.
  let quality: { claimsFalseCapability: boolean; quote: string; unavailable?: boolean } | undefined;
  if (judge) {
    const judged = [];
    for (const r of replies) judged.push(await judgeCapabilityClaims(r));
    const firstProblem = judged.find((j) => j.claimsFalseCapability);

    // WRITE IT DOWN. A finding that is printed and lost is not a finding
    // — a 1-in-6 event has to be caught again to be read a second time.
    if (firstProblem) recordFinding(c.id, firstProblem);
    quality = {
      claimsFalseCapability: firstProblem !== undefined,
      quote: firstProblem?.quote ?? "",
      ...(judged.some((j) => j.unavailable) ? { unavailable: true } : {}),
    };
  }

  // ── the world ──────────────────────────────────────────────────
  for (const [customerId, expected] of Object.entries(expect.world ?? {})) {
    const sub = convo.ctx.world.subscriptions.find((s) => s.customerId === customerId);
    if (!sub) failures.push(`no subscription for ${customerId}`);
    else if (sub.status !== expected) {
      failures.push(`${customerId} is "${sub.status}", expected "${expected}"`);
    }
  }

  // ── trajectory ─────────────────────────────────────────────────
  for (const tool of expect.mustCall ?? []) {
    if (!called.includes(tool)) failures.push(`${tool} was never called`);
  }
  for (const tool of expect.mustNotCall ?? []) {
    if (called.includes(tool)) failures.push(`${tool} ran and must not have`);
  }

  // ── stage ──────────────────────────────────────────────────────
  if (expect.finalStage && convo.stage !== expect.finalStage) {
    failures.push(`ended at ${convo.stage}, expected ${expect.finalStage}`);
  }

  // ── the reason for a denial, not just that one happened ────────
  if (expect.deniedBy && !denied.some((d) => d.ruleId === expect.deniedBy)) {
    failures.push(
      `nothing was denied by "${expect.deniedBy}"` +
        (denied.length ? ` (denials: ${denied.map((d) => d.ruleId).join(", ")})` : ""),
    );
  }

  return {
    id: c.id,
    pass: failures.length === 0,
    severity: c.severity ?? "quality",
    failures,
    called,
    denied,
    finalStage: convo.stage,
    ms: Date.now() - started,
    cost: since(costFrom),
    ...(quality ? { quality } : {}),
  };
}

/** Flagged findings are appended, never overwritten. */
function recordFinding(caseId: string, j: { quote: string; reason: string }): void {
  try {
    mkdirSync("eval-findings", { recursive: true });
    appendFileSync(
      "eval-findings/capability-claims.jsonl",
      JSON.stringify({ at: new Date().toISOString(), case: caseId, ...j }) + "\n",
    );
  } catch {
    // Recording a finding must never break the run that found it.
  }
}

export interface RepeatedResult {
  id: string;
  severity: "critical" | "quality";
  runs: number;
  passed: number;
  /** The WORST run. Never an average — averaging hides the failure. */
  worst: CaseResult;
  /** Passed some runs and failed others. A finding in its own right. */
  flaky: boolean;
  avgMs: number;
  /** Cost of ONE run — the per-conversation figure, not the total. */
  cost: CostSummary;
  /** How many runs the judge flagged. Reported, never blocking. */
  flaggedByJudge: number;
  judgeQuote: string;
  /** Runs where the judge could not answer. Distinct from "clean". */
  judgeUnavailable: number;
}

/**
 * Run a case N times.
 *
 * Non-determinism is the material, not a defect to be tuned away. A case
 * that passes 2/3 has told you something a single run cannot: that its
 * outcome depends on phrasing the model happened to choose. That is worth
 * knowing BEFORE a customer finds it.
 */
export async function runRepeated(
  c: EvalCase,
  policy: Policy,
  runs: number,
  judge = false,
): Promise<RepeatedResult> {
  const results: CaseResult[] = [];
  for (let i = 0; i < runs; i++) results.push(await runCase(c, policy, judge));

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);

  return {
    id: c.id,
    severity: c.severity ?? "quality",
    runs,
    passed,
    worst: failures[0] ?? results[0]!, // a failure if there was one
    flaky: passed > 0 && passed < runs,
    avgMs: results.reduce((a, r) => a + r.ms, 0) / runs,
    cost: results[0]!.cost,
    flaggedByJudge: results.filter((r) => r.quality?.claimsFalseCapability).length,
    judgeQuote: results.find((r) => r.quality?.claimsFalseCapability)?.quality?.quote ?? "",
    judgeUnavailable: results.filter((r) => r.quality?.unavailable).length,
  };
}

export function reportRepeated(results: RepeatedResult[]): boolean {
  console.log(`\n${"═".repeat(70)}`);
  for (const r of results) {
    const clean = r.passed === r.runs;
    const mark = clean ? "✔" : r.severity === "critical" ? "✖ CRITICAL" : "✖";
    const flag = r.flaky ? "  ⚠ FLAKY" : "";
    console.log(
      `${mark}  ${r.id.padEnd(44)} ${r.passed}/${r.runs}${flag}  ` +
        `${(r.avgMs / 1000).toFixed(1)}s  ` +
        `$${r.cost.usd.toFixed(4)} (${r.cost.calls} calls)`,
    );
    if (!clean) {
      console.log(`     worst run called: ${r.worst.called.join(" → ") || "(none)"}`);
      for (const f of r.worst.failures) console.log(`     ↳ ${f}`);
    }
    if (r.judgeUnavailable > 0) {
      console.log(`     ? judge could not answer on ${r.judgeUnavailable}/${r.runs} run(s) — quality UNKNOWN, not clean`);
    }
    if (r.flaggedByJudge > 0) {
      // Do not truncate. A finding you cannot read is not a finding.
      console.log(`     ⚑ capability claim (${r.flaggedByJudge}/${r.runs}):`);
      console.log(`       "${r.judgeQuote}"`);
    }
  }

  const fullyPassing = results.filter((r) => r.passed === r.runs).length;
  const flaky = results.filter((r) => r.flaky);
  const criticalFails = results.filter(
    (r) => r.passed < r.runs && r.severity === "critical",
  );
  const seconds = results.reduce((a, r) => a + r.avgMs * r.runs, 0) / 1000;

  console.log(`${"═".repeat(70)}`);
  console.log(`${fullyPassing}/${results.length} passed every run, in ${seconds.toFixed(0)}s`);

  // ── cost ────────────────────────────────────────────────────────
  const agentUsd = results.reduce((a, r) => a + r.cost.byPurpose.agent.usd, 0);
  const guardUsd = results.reduce((a, r) => a + r.cost.byPurpose.guard.usd, 0);
  const totalUsd = agentUsd + guardUsd;
  const avg = totalUsd / results.length;
  const guardShare = totalUsd > 0 ? (guardUsd / totalUsd) * 100 : 0;

  console.log(
    `\ncost per conversation: $${avg.toFixed(4)} average  ` +
      `(agent $${(agentUsd / results.length).toFixed(4)}, ` +
      `guards $${(guardUsd / results.length).toFixed(4)} — ${guardShare.toFixed(0)}%)`,
  );
  console.log(
    `at 100,000 conversations/day: $${(avg * 100_000).toLocaleString(undefined, { maximumFractionDigits: 0 })}/day`,
  );
  if (flaky.length) {
    console.log(`${flaky.length} flaky — passed sometimes. Investigate; do not re-run until green.`);
  }
  const judged = results.filter((r) => r.flaggedByJudge > 0);
  if (judged.length) {
    console.log(
      `\n⚑ ${judged.length} case(s) flagged by the judge for capability claims.` +
        // Keep in step with src/learn/judge-calibration.ts. A hardcoded
        // accuracy claim in a report is a document, and documents drift.
        `\n  Reported, not blocking — judge/human agreement 16/16 on 3 runs (2026-08-07).`,
    );
  }

  if (criticalFails.length) {
    console.log(`\n${criticalFails.length} CRITICAL failure(s) — this must not ship.`);
  }
  console.log("");

  return criticalFails.length === 0;
}

export function report(results: CaseResult[]): boolean {
  const pass = results.filter((r) => r.pass).length;
  const criticalFails = results.filter((r) => !r.pass && r.severity === "critical");

  console.log(`\n${"═".repeat(70)}`);
  for (const r of results) {
    const mark = r.pass ? "✔" : r.severity === "critical" ? "✖ CRITICAL" : "✖";
    console.log(`${mark}  ${r.id}  (${(r.ms / 1000).toFixed(1)}s)`);
    console.log(`     called: ${r.called.join(" → ") || "(none)"}`);
    if (r.denied.length) {
      console.log(`     denied: ${r.denied.map((d) => `${d.tool} [${d.ruleId}]`).join(", ")}`);
    }
    for (const f of r.failures) console.log(`     ↳ ${f}`);
  }

  const seconds = results.reduce((a, r) => a + r.ms, 0) / 1000;
  console.log(`${"═".repeat(70)}`);
  console.log(`${pass}/${results.length} passed in ${seconds.toFixed(0)}s`);
  if (criticalFails.length) {
    console.log(`\n${criticalFails.length} CRITICAL failure(s) — this must not ship.`);
  }
  console.log("");

  // Critical failures block. Quality failures are reported and tracked.
  return criticalFails.length === 0;
}
