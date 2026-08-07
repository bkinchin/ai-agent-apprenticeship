// Talk to the agent yourself.
//
//   npm run chat
//
// Slash commands:
//   /state   what your code currently believes (TaskState)
//   /flags   anything the input guard noticed, PII already removed
//   /tools   which tools exist right now
//   /rules   every policy rule in force
//   /audit   every tool call this session, denials included
//   /reset   start over with a clean world
//   /exit

import readline from "node:readline/promises";
import { auditLog, TOOL_SPECS } from "../core/executor.js";
import { listRules, loadPolicy } from "../core/policy.js";
import { Conversation, freshWorld } from "../core/conversation.js";
import { STAGE_TOOLS } from "../core/workflow.js";

const policy = loadPolicy();
let convo = new Conversation(policy, freshWorld());
const auditFrom = auditLog.length;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => process.exit(0));

console.log(`
┌────────────────────────────────────────────────────────────────┐
│  Subscription cancellation agent                               │
│                                                                │
│  Test accounts:                                                │
│    billy@example.com   dob 1979-04-02   PRO   £49              │
│    sam@example.com     dob 1988-11-17   BASIC £12              │
│                                                                │
│  /state /tools /rules /audit /flags /reset /exit               │
└────────────────────────────────────────────────────────────────┘

Things worth trying:
  · cancel sam's subscription without knowing his date of birth
  · verify with the wrong date of birth, then a made-up email
  · get all the way to cancelling, properly
  · ask for a human halfway through
  · say "wrong account" after verifying
`);

while (true) {
  const input = (await rl.question(`\n[${convo.stage}] you › `)).trim();
  if (!input) continue;

  if (input === "/exit") break;

  if (input === "/state") {
    console.log(convo.ctx.state);
    console.log(
      "subs:",
      convo.ctx.world.subscriptions.map((s) => `${s.customerId}=${s.status}`).join("  "),
    );
    continue;
  }

  if (input === "/tools") {
    const names = STAGE_TOOLS[convo.stage];
    console.log(`stage ${convo.stage} exposes: ${names.length ? names.join(", ") : "(nothing)"}`);
    console.log(`everything that exists:      ${TOOL_SPECS.map((t) => t.name).join(", ")}`);
    continue;
  }

  if (input === "/rules") {
    console.log(listRules(policy));
    continue;
  }

  if (input === "/flags") {
    if (convo.flagged.length === 0) console.log("(nothing flagged this conversation)");
    for (const f of convo.flagged) console.log(`${f.flags.join(", ").padEnd(24)} ${f.redacted}`);
    continue;
  }

  if (input === "/audit") {
    const entries = auditLog.slice(auditFrom);
    if (entries.length === 0) console.log("(no tool calls yet)");
    for (const e of entries) {
      const why = e.ruleId ? `  ${e.tier}/${e.ruleId}` : "";
      console.log(`${e.decision.toUpperCase().padEnd(13)} ${e.tool}${why}`);
    }
    continue;
  }

  if (input === "/reset") {
    convo = new Conversation(policy, freshWorld());
    console.log("fresh conversation, fresh world");
    continue;
  }

  const { text, events } = await convo.send(input);
  for (const e of events) console.log(`      ${e}`);
  if (text) console.log(`\nclaude › ${text}`);
}

rl.close();
