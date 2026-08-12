// Talk to the knowledge agent.
//
//   npm run ask
//   ANTHROPIC_MODEL=claude-opus-5 npm run ask
//
// Exists because last week fourteen of twenty-two defects were found by
// a person typing at the agent and reading what came back, and two were
// found by the eval suite. A golden set is a ratchet; a transcript is a
// detector.

import { createInterface } from "node:readline/promises";
import { ask, MODEL } from "../core/answer.js";
import { isStale, loadDocuments, loadStructured } from "../core/corpus.js";

const docs = loadDocuments();
const structured = loadStructured();
const stale = docs.filter((d) => isStale(d));

console.log(`
┌──────────────────────────────────────────────────────────────────┐
│  Golf club knowledge agent                                       │
│                                                                  │
│  model: ${MODEL.padEnd(56)}│
│  ${String(docs.length).padStart(2)} documents · ${String(stale.length)} past review date                            │
│                                                                  │
│  /sources  /stale  /structured  /exit                            │
└──────────────────────────────────────────────────────────────────┘

Things worth trying:
  · how much does it cost to bring a guest?        ← stale prose vs live data
  · can I wear jeans in the spike bar?             ← two owners, both right
  · can I bring my dog?                            ← nothing in the corpus
  · what handicap do I need for the Championship?  ← adjacent info, no answer
  · what's the green fee for a visitor on Tuesday? ← a tempting wrong answer nearby
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
let spent = 0;

for (;;) {
  let q: string;
  try {
    q = (await rl.question("\x1b[36myou › \x1b[0m")).trim();
  } catch {
    break; // EOF — piped input ran out, or Ctrl-D
  }
  if (!q) continue;

  if (q === "/exit") break;
  if (q === "/sources") {
    for (const d of docs) {
      console.log(
        `  ${d.id.padEnd(28)} ${d.owner.padEnd(22)} updated ${d.lastUpdated}` +
          `${isStale(d) ? "  ← STALE" : ""}`,
      );
    }
    continue;
  }
  if (q === "/stale") {
    if (stale.length === 0) console.log("  nothing past its review date");
    for (const d of stale) console.log(`  ${d.id} — review was due ${d.reviewDue}`);
    continue;
  }
  if (q === "/structured") {
    console.log(JSON.stringify(structured, null, 2));
    continue;
  }

  const r = await ask(q, docs, structured);
  const price = MODEL.includes("haiku") ? { in: 1, out: 5 } : { in: 5, out: 25 };
  spent += (r.usage.input / 1e6) * price.in + (r.usage.output / 1e6) * price.out;

  if (!r.answer) {
    console.log("\n  ⚠ no parseable answer\n");
    continue;
  }

  if (r.answer.status === "not_in_knowledge_base") {
    // Not an error. This is the branch working.
    console.log(`\n\x1b[33m[declined]\x1b[0m ${r.answer.reason}`);
    console.log(`           ${r.answer.suggestion}\n`);
  } else {
    console.log(`\n${r.answer.answer}\n`);
    for (const c of r.answer.citations) {
      const doc = docs.find((d) => d.id === c.source);
      const flag = doc && isStale(doc) ? "  \x1b[33m← STALE\x1b[0m" : "";
      console.log(`  \x1b[2m▸ ${c.source}${flag}\x1b[0m`);
      console.log(`    \x1b[2m"${c.quote.slice(0, 100).replace(/\s+/g, " ")}"\x1b[0m`);
    }
    // An unsourced claim about a club is the failure this exists to stop.
    if (r.uncited) console.log("  \x1b[31m⚑ ANSWERED WITH NO CITATION\x1b[0m");
    for (const b of r.badCitations) {
      console.log(`  \x1b[31m⚑ bad citation — ${b.source}: ${b.why}\x1b[0m`);
    }
    console.log("");
  }
  console.log(`  \x1b[2m$${spent.toFixed(4)} this session\x1b[0m\n`);
}

rl.close();
