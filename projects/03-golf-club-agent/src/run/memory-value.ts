// What memory is worth, and what it costs when it is wrong.
//
//   npm run memory-value
//
// Two experiments the curriculum asks for, in one script because they
// are the same experiment with different contents:
//
//   11. Run scenarios with memory ON and OFF. Did it actually help?
//   12. Plant a WRONG memory and watch what a confident false belief
//       does to a conversation.
//
// Both matter more than the store itself. A memory system that cannot
// show its value is a liability with a feature attached, and one whose
// failures you have never seen is a liability you have not measured.

import { MemoryStore } from "../memory/store.js";
import { newSession, turn, memory } from "../core/agent.js";
import { memberText } from "../core/render.js";
import { contactsFrom, guestFeeFrom } from "../core/render.js";
import { loadStructured } from "../core/corpus.js";

const structured = loadStructured();
const contacts = contactsFrom(structured);
const guestFee = guestFeeFrom(structured);

const SUBJECT = "M-1001";

const say = async (s: ReturnType<typeof newSession>, text: string) => {
  console.log(`\n\x1b[36myou ›\x1b[0m ${text}`);
  for (const r of await turn(s, text)) {
    if (r.kind === "trace") {
      console.log(`  \x1b[2m→ ${r.tool}(${JSON.stringify(r.args)})\x1b[0m`);
      continue;
    }
    const t = memberText(r, contacts, guestFee);
    if (t) console.log(`\n${t}`);
  }
};

const rule = (label: string) =>
  console.log(`\n\x1b[1m${"═".repeat(70)}\n${label}\n${"═".repeat(70)}\x1b[0m`);

// ── 11. on / off ────────────────────────────────────────────────
memory.forgetAll(SUBJECT);

rule("11a. MEMORY OFF — a returning member, nothing remembered");
{
  const s = newSession(SUBJECT);
  await say(s, "morning, can I get a game saturday the 29th?");
}

rule("11b. MEMORY ON — the same question, one preference stored");
memory.remember(SUBJECT, {
  type: "preference",
  key: "preferred_tee_time",
  value: "before 09:00",
  confidence: 0.95,
  source: {
    sessionId: "S-earlier",
    turnIndex: 4,
    quote: "remember that I always want to play before 9am",
  },
});
{
  const s = newSession(SUBJECT);
  await say(s, "morning, can I get a game saturday the 29th?");
}

// ── 12. the planted wrong memory ────────────────────────────────
//
// A handicap is a LOOKUP — it lives in the handicap system, and day
// 11's central rule says do not remember what a system of record
// knows. This plants it as a memory anyway, which is what a team does
// when the lookup is inconvenient and "the agent should just know".
//
// The member's real handicap is 22. The memory says 4.
rule("12. A WRONG MEMORY — the store says handicap 4, the truth is 22");
memory.forgetAll(SUBJECT);
memory.remember(SUBJECT, {
  type: "factual",
  key: "handicap",
  value: "handicap index of 4",
  confidence: 0.9,
  source: {
    sessionId: "S-wrong",
    turnIndex: 2,
    quote: "I came off 4 back in the day",
  },
});
{
  const s = newSession(SUBJECT);
  await say(s, "am I eligible for the Club Championship?");
  await say(s, "and what tees would I be playing off?");
}

memory.forgetAll(SUBJECT);
console.log("\n(store cleaned)\n");
process.exit(0);
