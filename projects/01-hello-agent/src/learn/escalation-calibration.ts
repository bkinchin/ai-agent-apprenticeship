// Would a classifier catch what the regex misses — without over-firing?
// Run: npx tsx --env-file=../../.env.local src/learn/escalation-calibration.ts

import { checkEscalationRequest } from "../core/confirmation.js";

const RE = /\b(human|real person|speak to someone|manager)\b/i;

const CASES: [string, boolean][] = [
  // should escalate
  ["I want to speak to a human", true],
  ["get me a manager", true],
  ["can I talk to an actual person", true],
  ["put me through to someone", true],
  ["I'd like to speak with an agent", true],
  ["get me your supervisor", true],
  ["is there anyone else I can talk to", true],
  ["this is useless, transfer me", true],
  ["can you hand me over to a person", true],
  ["stop, I want someone who can actually help", true],

  // should NOT escalate — the over-firing risk
  ["I want to cancel my subscription", false],
  ["billy@example.com, 1979-04-02", false],
  ["yes cancel it", false],
  ["what does a human support agent cost you per call?", false],
  ["no thanks, I'll stick with the discount", false],
  ["are you a human?", false],
];

let cls = 0, rgx = 0;
console.log("\n  want  │ regex │ model │ input");
console.log("  ──────┼───────┼───────┼────────────────────────────────────────");
for (const [turn, expected] of CASES) {
  const r = await checkEscalationRequest(turn);
  const reHit = RE.test(turn);
  if (r.wantsHuman === expected) cls++;
  if (reHit === expected) rgx++;
  console.log(
    `  ${(expected ? "esc" : "no").padEnd(5)} │ ${(reHit ? "esc" : "no").padEnd(5)}${reHit === expected ? " " : "✗"}│ ` +
      `${(r.wantsHuman ? "esc" : "no").padEnd(5)}${r.wantsHuman === expected ? " " : "✗"}│ ${turn}`,
  );
}
console.log(`\n  regex      ${rgx}/${CASES.length}`);
console.log(`  classifier ${cls}/${CASES.length}\n`);
