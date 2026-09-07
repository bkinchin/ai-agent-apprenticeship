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
import { memory, newSession, spent, turn, usage, type Reply } from "../core/agent.js";
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

/**
 * A tee time that is genuinely inside the 24-hour window, computed now.
 *
 * FIXTURES THAT HARDCODE A DATE ROT. This case said "tomorrow the
 * 27th"; two days later it was asking to book yesterday, and the suite
 * failed for a reason that had nothing to do with the agent —
 * "a test whose result depends on the day it runs is a test that will
 * one day fail for a reason nobody can reproduce", which is written in
 * dates.test.ts by the person who then hardcoded these.
 *
 * Returns undefined when there is no such slot — running at 9pm, every
 * remaining tee time today has gone. That SKIPS the case rather than
 * failing it, because a case that cannot run is an unknown and day 7's
 * rule holds: a system that cannot tell "wrong" from "unknown" will
 * eventually report one as the other.
 */
function slotInside24h(now = new Date()): { date: string; time: string } | undefined {
  const syd = (d: Date) => ({
    date: d.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }),
    hour: Number(d.toLocaleTimeString("en-GB", { timeZone: "Australia/Sydney", hour: "2-digit", hour12: false })),
  });

  // Three hours from now, if the tee sheet is open then (07:00–17:30)
  // and the club has its hour of notice.
  const soon = syd(new Date(now.getTime() + 3 * 3600e3));
  if (soon.hour >= 7 && soon.hour <= 17) {
    return { date: soon.date, time: `${String(soon.hour).padStart(2, "0")}:00` };
  }

  // Otherwise tomorrow's first slot — which is inside 24 hours whenever
  // it is later than 07:00 today. Added because the case skipped at
  // 17:22 on an ordinary weekday: correct, and needlessly often.
  const tomorrow = syd(new Date(now.getTime() + 864e5));
  const hoursAway = (new Date(`${tomorrow.date}T07:00:00+10:00`).getTime() - now.getTime()) / 3600e3;
  if (hoursAway > 1 && hoursAway < 24) return { date: tomorrow.date, time: "07:00" };

  return undefined;
}


/**
 * The next occurrence of a weekday, as the club would say it.
 *
 * Fixtures named absolute dates — "saturday the 29th" — which pass this
 * week and fail next week for a reason that has nothing to do with the
 * agent. A golden set with a shelf life is a golden set that gets
 * deleted the first time somebody is in a hurry.
 */
function nextWeekday(name: string, now = new Date()): string {
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const want = days.indexOf(name.toLowerCase());
  const iso = now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!));
  let add = (want - base.getUTCDay() + 7) % 7;
  if (add === 0) add = 7; // "saturday" on a Saturday means the NEXT one
  const then = new Date(base.getTime() + add * 864e5);
  const day = then.getUTCDate();
  const suffix = day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${name} the ${day}${suffix}`;
}

/** The ISO date of the next such weekday, for assertions. */
function nextWeekdayISO(name: string, now = new Date()): string {
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const want = days.indexOf(name.toLowerCase());
  const iso = now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!));
  let add = (want - base.getUTCDay() + 7) % 7;
  if (add === 0) add = 7;
  return new Date(base.getTime() + add * 864e5).toISOString().slice(0, 10);
}

/** Substitute every relative token in a fixture string. */
function resolve(text: string, soon: { date: string; time: string } | undefined): string {
  return text
    .replace(/\{\{soonDate\}\}/g, soon?.date ?? "")
    .replace(/\{\{soonTime\}\}/g, soon?.time ?? "")
    .replace(/\{\{(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\}\}/gi, (_, d) => nextWeekday(d))
    .replace(/\{\{iso:(saturday|sunday|monday|tuesday|wednesday|thursday|friday)\}\}/gi, (_, d) => nextWeekdayISO(d));
}

async function runCase(c: ConversationCase): Promise<Result> {
  const r: Result = { id: c.id, why: c.why, failures: [], reports: [], calls: [], replies: [] };
  const soon = slotInside24h();

  // Each case starts from nothing. A case that passes only because a
  // previous one left state behind is not a case.
  if (c.turns.some((t) => t.includes("{{soon")) && !slotInside24h()) {
    // Not a pass. Not a fail. An unknown, said out loud.
    r.errored = "no tee slot inside the 24-hour window at this hour — run it during the day";
    return r;
  }

  memory.forgetAll(c.memberId);
  if (existsSync(IDEM)) unlinkSync(IDEM);
  await fetch("http://localhost:4010/_reset", { method: "POST" }).catch(() => {});

  const s = newSession(c.memberId);
  try {
    for (const raw of c.turns) {
      // Fixtures name times relatively; the runner resolves them now.
      const t = resolve(raw, soon);
      for (const reply of await turn(s, t)) collect(reply, r);
    }
  } catch (e) {
    r.errored = (e as Error).message;
    return r;
  }

  // Assertions carry the same tokens, so a case can say
  // {{iso:saturday}} and still assert on the exact slot it booked.
  const e = JSON.parse(resolve(JSON.stringify(c.expect), soon)) as typeof c.expect;

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
    // EXECUTED calls only, consistent with mustCall. A refused attempt
    // is the guard working, not the defect — asserting on attempts
    // failed a case where a bad guest count was caught and the agent
    // correctly asked the member instead. Second time this exact
    // inconsistency has bitten; the rule is that assertions are about
    // what HAPPENED.
    const blob = JSON.stringify(r.calls.filter((x) => !x.refused)).toLowerCase();
    if (blob.includes(bad.toLowerCase())) {
      r.failures.push(`"${bad}" must not appear in any tool argument`);
    }
  }

  for (const must of e.replyMustContain ?? []) {
    // CASE-INSENSITIVE. The agent said "the competition secretary" and
    // this demanded "Competition Secretary", failing a reply that was
    // correct. Gating on capitalisation is the fuzzy-prose gating the
    // testing standard warns about, wearing a disguise: the assertion
    // is about whether a fact reached the member, not about how it was
    // typeset.
    if (!r.replies.some((x) => x.toLowerCase().includes(must.toLowerCase()))) {
      r.failures.push(`no reply contained "${must}" — said: ${r.replies.join(" | ").slice(0, 200)}`);
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
const filter = process.argv[2] === "--list" ? undefined : process.argv[2];
const cases = filter ? CASES.filter((c) => c.id.includes(filter)) : CASES;
if (cases.length === 0) {
  console.error(`no case matching "${filter}"`);
  process.exit(2);
}

// --list prints what is covered without calling a model. A suite you
// cannot inspect for free is a suite nobody checks the coverage of.
if (filter === "--list" || process.argv.includes("--list")) {
  const wrap = (t: string, indent: string) =>
    t.replace(/(.{1,66})(\s|$)/g, `$1\n${indent}`).trimEnd();
  for (const c of CASES) {
    console.log(`\n\x1b[1m${c.id}\x1b[0m${c.runs ? dim(`  ×${c.runs}`) : ""}`);
    console.log(dim(`  ${wrap(c.why, "  ")}`));
    console.log(`  \x1b[36mmember\x1b[0m ${c.memberId}`);
    // Tokens resolved for display, so --list shows what will actually
    // be said rather than the template.
    for (const t of c.turns) console.log(`  \x1b[36m›\x1b[0m ${resolve(t, slotInside24h())}`);
    const e = c.expect;
    for (const m of e.mustCall ?? [])
      console.log(`  \x1b[32m✓ must call\x1b[0m ${m.tool}${m.args ? `(${JSON.stringify(m.args)})` : ""}`);
    for (const m of e.mustNotCall ?? [])
      console.log(`  \x1b[31m✗ must NOT call\x1b[0m ${m}`);
    if (e.memoriesAfter !== undefined)
      console.log(`  \x1b[32m✓ memories after\x1b[0m ${e.memoriesAfter}`);
    for (const a of e.argsMustNotContain ?? [])
      console.log(`  \x1b[31m✗ never in any argument\x1b[0m "${a}"`);
    for (const a of e.replyMustContain ?? [])
      console.log(`  \x1b[32m✓ reply contains\x1b[0m "${a}" ${dim("(code-generated)")}`);
    if (e.replyShouldMention)
      console.log(`  ${dim(`· reported only: reply mentions one of ${e.replyShouldMention.join(", ")}`)}`);
  }
  console.log(`\n${CASES.length} cases · ${CASES.reduce((n, c) => n + (c.runs ?? 1), 0)} runs\n`);
  process.exit(0);
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
console.log(
  `cost     $${spent().toFixed(4)}  ` +
    dim(`(${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out, ${MODEL})`),
);
console.log(`passed   ${passed}/${cases.length}`);
console.log(`failed   ${failed.length}`);
console.log(`errored  ${errored.length}   ${errored.length ? "← NOT a pass and NOT a fail" : ""}`);

if (failed.length) {
  console.log(`\nwhat each failure was protecting:`);
  for (const f of failed) console.log(`\n  ${f.id}\n  ${dim(f.why)}`);
}

// An errored case is an unknown, and an unknown blocks. Day 7.
process.exit(failed.length + errored.length === 0 ? 0 : 1);
