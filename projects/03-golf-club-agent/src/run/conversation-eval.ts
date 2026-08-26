// Run the conversational golden set.
//
//   npm run conversations
//
// Six cases, ~20 turns, a few cents. Cheap on purpose: a suite that
// costs a dollar is a suite nobody runs, and a suite nobody runs does
// not exist.
//
// THE GATE/REPORT SPLIT IS THE DESIGN. Tool calls and their arguments
// are deterministic enough to fail a build on. Wording is not — day 9
// spent seven assertion errors learning that, and gating on a fuzzy
// signal is how a suite gets switched off.
//
// A case that ERRORS is neither a pass nor a fail. Day 7's rule: a
// system that cannot tell "wrong" from "unknown" will eventually report
// one as the other, so an errored case blocks the summary rather than
// quietly counting as a pass.

import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { CASES, type ConversationCase } from "../eval/conversations.js";
import { memory, newSession, turn, type Reply } from "../core/agent.js";
import { MODEL } from "../core/answer.js";
import { contactsFrom, guestFeeFrom, memberText } from "../core/render.js";
import { loadStructured } from "../core/corpus.js";

const structured = loadStructured();
const contacts = contactsFrom(structured);
const guestFee = guestFeeFrom(structured);

const IDEM = ".idempotency.json";
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;

interface Result {
  id: string;
  why: string;
  failures: string[];
  reports: string[];
  errored?: string;
  calls: { tool: string; args: Record<string, unknown>; refused: boolean }[];
  replies: string[];
}

/** Does `got` contain every key/value in `want`? Subset, not equality. */
const matches = (got: Record<string, unknown>, want: Record<string, unknown>) =>
  Object.entries(want).every(([k, v]) => got[k] === v);

async function runCase(c: ConversationCase): Promise<Result> {
  const r: Result = { id: c.id, why: c.why, failures: [], reports: [], calls: [], replies: [] };

  // Each case starts from nothing. A case that passes only because a
  // previous one left state behind is not a case.
  memory.forgetAll(c.memberId);
  if (existsSync(IDEM)) unlinkSync(IDEM);
  await fetch("http://localhost:4010/_reset", { method: "POST" }).catch(() => {});

  const s = newSession(c.memberId);
  try {
    for (const t of c.turns) {
      for (const reply of await turn(s, t)) collect(reply, r);
    }
  } catch (e) {
    r.errored = (e as Error).message;
    return r;
  }

  const e = c.expect;

  for (const want of e.mustCall ?? []) {
    const hit = r.calls.find(
      (x) => !x.refused && x.tool === want.tool && (!want.args || matches(x.args, want.args)),
    );
    if (!hit) {
      const seen = r.calls.filter((x) => !x.refused && x.tool === want.tool);
      r.failures.push(
        `expected ${want.tool}(${JSON.stringify(want.args ?? {})}) — ` +
          (seen.length
            ? `got ${seen.map((x) => JSON.stringify(x.args)).join(", ")}`
            : `it was never called`),
      );
    }
  }

  for (const tool of e.mustNotCall ?? []) {
    if (r.calls.some((x) => x.tool === tool)) r.failures.push(`${tool} MUST NOT be called`);
  }

  if (e.memoriesAfter !== undefined) {
    const held = memory.recall(c.memberId);
    if (held.length !== e.memoriesAfter) {
      r.failures.push(
        `expected ${e.memoriesAfter} memories, found ${held.length}: ` +
          held.map((m) => `${m.key}="${m.value}"`).join(", "),
      );
    }
  }

  for (const bad of e.argsMustNotContain ?? []) {
    const blob = JSON.stringify(r.calls).toLowerCase();
    if (blob.includes(bad.toLowerCase())) {
      r.failures.push(`"${bad}" must not appear in any tool argument`);
    }
  }

  // Near-misses on tools that CHANGE THE WORLD. A refused
  // remember_preference is the write policy working normally and would
  // drown the signal; a refused booking is the model having tried to
  // do something wrong with a member's money.
  const worldChanging = new Set(["book_tee_time", "cancel_booking"]);
  for (const near of r.calls.filter((x) => x.refused && worldChanging.has(x.tool))) {
    r.reports.push(`near-miss — ${near.tool}(${JSON.stringify(near.args)}) was refused`);
  }

  // REPORTED, NOT GATED.
  if (e.replyShouldMention?.length) {
    const said = r.replies.join(" ").toLowerCase();
    if (!e.replyShouldMention.some((m) => said.includes(m.toLowerCase()))) {
      r.reports.push(`reply mentioned none of: ${e.replyShouldMention.join(", ")}`);
    }
  }

  memory.forgetAll(c.memberId);
  return r;
}

function collect(reply: Reply, r: Result): void {
  if (reply.kind === "trace") {
    if (reply.tool !== "(preamble)") {
      // A REFUSED CALL IS AN ATTEMPT, NOT AN OUTCOME.
      //
      // The guards return a refusal that the model then acts on, so the
      // trace holds both the wrong attempt and the corrected one.
      // Asserting on attempts failed a case where the agent had done
      // exactly the right thing — caught a bad party size and rebooked
      // it properly — which would have taught us to distrust a working
      // guard.
      //
      // Attempts are still recorded, and reported, because a near-miss
      // is worth seeing: it is the difference between "the model never
      // does this" and "the model does this and we catch it".
      r.calls.push({
        tool: reply.tool,
        args: reply.args as Record<string, unknown>,
        refused: /^(Refused|Not stored)/.test(reply.note),
      });
    }
    return;
  }
  const t = memberText(reply, contacts, guestFee);
  if (t) r.replies.push(t);
}

// ── run ─────────────────────────────────────────────────────────
// One case at a time, so a control costs three cents rather than twenty.
const filter = process.argv[2];
const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;
if (cases.length === 0) {
  console.error(`no case matching "${filter}"`);
  process.exit(2);
}

const server = spawn("npx", ["tsx", "tee-sheet/server.ts"], { stdio: "ignore" });
await new Promise((res) => setTimeout(res, 3000));

console.log(`\nconversational golden set · ${MODEL} · ${cases.length} case(s)\n`);

const results: Result[] = [];
try {
  for (const c of cases) {
    // Every run must pass. An assertion that a destructive tool was not
    // called is only as strong as its unluckiest run, so failures are
    // merged rather than averaged — there is no "mostly did not cancel
    // the member's booking".
    const runs = c.runs ?? 1;
    let r = await runCase(c);
    for (let n = 1; n < runs && !r.errored; n++) {
      const again = await runCase(c);
      r = {
        ...r,
        failures: [...r.failures, ...again.failures.map((f) => `run ${n + 1}: ${f}`)],
        reports: [...r.reports, ...again.reports],
        errored: again.errored,
      };
    }
    results.push(r);
    const mark = r.errored ? "\x1b[33m?\x1b[0m" : r.failures.length ? "\x1b[31m✖\x1b[0m" : "\x1b[32m✔\x1b[0m";
    console.log(`${mark}  ${r.id}${runs > 1 ? dim(`  ×${runs}`) : ""}`);
    for (const f of r.failures) console.log(`     \x1b[31m${f}\x1b[0m`);
    if (r.errored) console.log(`     \x1b[33merrored: ${r.errored}\x1b[0m`);
    for (const rep of r.reports) console.log(`     ${dim(rep)}`);
  }
} finally {
  server.kill();
  if (existsSync(IDEM)) unlinkSync(IDEM);
}

const failed = results.filter((r) => r.failures.length && !r.errored);
const errored = results.filter((r) => r.errored);
const passed = results.length - failed.length - errored.length;

console.log(`\n${"═".repeat(70)}`);
console.log(`passed   ${passed}/${cases.length}`);
console.log(`failed   ${failed.length}`);
console.log(`errored  ${errored.length}   ${errored.length ? "← NOT a pass and NOT a fail" : ""}`);

if (failed.length) {
  console.log(`\nwhat each failure was protecting:`);
  for (const f of failed) console.log(`\n  ${f.id}\n  ${dim(f.why)}`);
}

// An errored case is an unknown, and an unknown blocks. Day 7.
process.exit(failed.length + errored.length === 0 ? 0 : 1);
