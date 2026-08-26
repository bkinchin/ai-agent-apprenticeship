// The staff console.
//
//   npm run console            open escalations, most urgent first
//   npm run console ESC-...    read one
//   npm run console roadmap    what the agent was missing, by volume
//
// A CLI, deliberately. The console's job today is to make the HANDOFF
// PACKAGE testable against a real reader — exercise 11 is to sit down
// as the pro shop manager and find out what is missing from it. A nicer
// interface would not change that answer and would take the afternoon.
//
// No model calls. Nothing here needs one.

import { createInterface } from "node:readline/promises";

/**
 * Ask a series of questions, from a terminal or from a pipe.
 *
 * readline CONSUMES STDIN WHILE YOU AWAIT, so piped answers arriving
 * during a question that is not yet pending are dropped and the next
 * await never settles. chat.ts solved this two days ago by reading a
 * non-TTY stdin to completion first; this file was written afterwards
 * and did not carry the fix across, which is what happens when a
 * pattern lives in one file rather than in a function.
 */
async function asker(): Promise<(q: string) => Promise<string>> {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    return async (q) => (await rl.question(q)).trim();
  }
  const all = await new Promise<string>((res) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => res(buf));
  });
  const lines = all.split("\n");
  let i = 0;
  return async (q) => {
    const a = (lines[i++] ?? "").trim();
    console.log(`${q}${a}`);
    return a;
  };
}
import { Actions, Queue } from "../escalation/queue.js";
import { cancelBooking } from "../tools/tee-sheet.js";
import { render } from "../escalation/handoff.js";

const q = new Queue();
const acts = new Actions();
const arg = process.argv[2];
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;

if (arg?.startsWith("ACT-")) {
  // ASSISTED MODE: one action, its exact arguments, its exact
  // consequence, and a yes or no. The human is not being asked to work
  // out what to do — that is what makes this ten seconds rather than a
  // phone call.
  const a = acts.get(arg);
  if (!a) {
    console.error(`no action ${arg}`);
    process.exit(1);
  }
  if (a.decision) {
    console.log(`\n${arg} already ${a.decision.approved ? "approved" : "rejected"} by ${a.decision.by}\n`);
    process.exit(0);
  }
  console.log(`\n\x1b[1m${a.ref}\x1b[0m  member ${a.memberId}`);
  console.log(`\nWILL RUN   ${a.tool}(${JSON.stringify(a.args)})`);
  console.log(`EFFECT     ${a.effect}`);
  console.log(`WHY YOU    ${a.because}`);

  const ask = await asker();
  const yes = (await ask(`\nApprove? (y/n) `)).toLowerCase().startsWith("y");
  const note = await ask(`Note (optional): `);
  const by = (await ask(`Your name? `)) || "staff";

  // Recorded BEFORE executing, and refused if a decision already
  // exists. Approving twice must not cancel twice, and a console is
  // exactly where somebody presses the key again after a slow response.
  if (!acts.decide(arg, { at: new Date().toISOString(), by, approved: yes, note })) {
    console.log(`\n\x1b[33mAlready decided — nothing run.\x1b[0m\n`);
    process.exit(0);
  }

  if (!yes) {
    console.log(`\n\x1b[33mRejected. Nothing was cancelled or charged.\x1b[0m\n`);
    process.exit(0);
  }

  try {
    await cancelBooking({
      bookingId: String(a.args.bookingId),
      memberId: String(a.args.memberId),
      sessionId: a.ref,   // the approval IS the intent — idempotent on retry
      step: 1,
    });
    console.log(`\n\x1b[32mDone. ${a.effect}\x1b[0m\n`);
  } catch (e) {
    console.log(`\n\x1b[31mThe tee sheet refused it: ${(e as Error).message}\x1b[0m`);
    console.log(`The approval is recorded; run it again once the tee sheet is back.\n`);
  }
  process.exit(0);
}

if (arg === "roadmap") {
  // ESCALATION REASONS SORTED BY VOLUME ARE THE PRODUCT ROADMAP.
  const rows = q.roadmap();
  if (rows.length === 0) {
    console.log("\nNothing resolved yet — the roadmap comes from what humans actually did.\n");
  } else {
    console.log(`\nWhat the agent was missing, by volume:\n`);
    for (const r of rows) {
      console.log(`  ${String(r.count).padStart(3)}  ${r.missing.padEnd(12)} ${dim(r.triggers)}`);
    }
    console.log(
      `\n${dim("knowledge → write it down · tool → build it · out_of_scope → a PRD decision")}`,
    );
    console.log(`${dim("judgement → correctly a person's job, and always will be")}\n`);
  }
  process.exit(0);
}

if (arg?.startsWith("ESC-")) {
  const h = q.get(arg);
  if (!h) {
    console.error(`no escalation ${arg}`);
    process.exit(1);
  }
  console.log(`\n${render(h)}`);
  console.log(`\nTRANSCRIPT`);
  for (const t of h.transcript) {
    console.log(`  ${t.role === "member" ? "\x1b[36mmember\x1b[0m" : "agent "}  ${t.text}`);
  }
  if (h.resolution) {
    console.log(`\n\x1b[32mRESOLVED\x1b[0m ${h.resolution.resolvedAt} by ${h.resolution.resolvedBy}`);
    console.log(`  ${h.resolution.whatIDid}`);
    console.log(`  agent could have handled it: ${h.resolution.agentCouldHave ? "yes" : "no"}`);
    console.log(`  missing: ${h.resolution.missing}`);
    process.exit(0);
  }

  // Resolving is where the improvement loop gets its data, so it is
  // three questions rather than a "done" button. The second one is the
  // valuable one and only a human who has just done the work can
  // answer it.
  const ask = await asker();
  const did = await ask(`\nWhat did you do? `);
  const could = (await ask(`Could the agent have handled it? (y/n) `)).toLowerCase();
  const missing = could.startsWith("y")
    ? "none"
    : (await ask(`What was missing? (knowledge/tool/policy/judgement/out_of_scope) `)) || "judgement";
  const by = (await ask(`Your name? `)) || "staff";

  q.resolve(arg, {
    resolvedAt: new Date().toISOString(),
    resolvedBy: by,
    whatIDid: did,
    agentCouldHave: could.startsWith("y"),
    missing: missing as never,
  });
  console.log(`\n\x1b[32m${arg} resolved.\x1b[0m\n`);
  process.exit(0);
}

const waiting = acts.pending();
if (waiting.length) {
  console.log(`\n\x1b[1m${waiting.length} action(s) waiting for approval\x1b[0m\n`);
  for (const a of waiting) {
    console.log(`  \x1b[35mapproval\x1b[0m        ${a.ref}  ${a.memberId.padEnd(22)} ${dim(a.effect)}`);
  }
}

const open = q.open();
console.log(`\n${open.length} open escalation(s)\n`);
for (const h of open) {
  const colour = h.urgency === "immediate" ? "31" : h.urgency === "same_day" ? "33" : "2";
  console.log(
    `  \x1b[${colour}m${h.urgency.replace(/_/g, " ").padEnd(17)}\x1b[0m ${h.ref}  ` +
      `${h.team.replace(/_/g, " ").padEnd(22)} ${dim(h.triggerId.replace(/_/g, " "))}`,
  );
  console.log(`  ${" ".repeat(17)} ${dim(h.summary.slice(0, 60))}`);
}
console.log(`\n${dim("npm run console ESC-...   to read and resolve one")}`);
console.log(`${dim("npm run console ACT-...   approve or reject a drafted action")}`);
console.log(`${dim("npm run console roadmap   what the agent was missing")}\n`);
