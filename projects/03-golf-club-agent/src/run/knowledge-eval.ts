// Run the knowledge golden set and report.
//
//   npm run knowledge            all 20
//   npm run knowledge -- abstain only ids containing "abstain"
//
// THE NUMBER THAT MATTERS is the invention rate: of the five questions
// the corpus cannot answer, how many did the agent answer anyway?
// Accuracy on answerable questions tells you the retrieval works.
// Invention rate tells you whether you can trust any of it.

import { ask, MODEL } from "../core/answer.js";
import { loadDocuments, loadStructured } from "../core/corpus.js";
import { QUESTIONS } from "../eval/questions.js";

const filter = process.argv[2];
const cases = filter ? QUESTIONS.filter((q) => q.id.includes(filter)) : QUESTIONS;

const docs = loadDocuments();
const structured = loadStructured();

// Rough token estimate of what we send every single call.
const corpusChars =
  docs.reduce((n, d) => n + d.body.length, 0) + JSON.stringify(structured).length;

console.log(`\nmodel: ${MODEL}`);
console.log(`corpus: ${docs.length} documents, ~${Math.round(corpusChars / 4 / 1000)}k tokens stuffed per call`);
console.log(`running ${cases.length} question(s)...\n`);

type Outcome = "correct" | "wrong-source" | "wrong-value" | "invented" | "over-abstained" | "uncited" | "unparseable";
const results: { id: string; outcome: Outcome; detail: string; bad: number }[] = [];
let inputTokens = 0;
let outputTokens = 0;

for (const q of cases) {
  const r = await ask(q.question, docs, structured);
  inputTokens += r.usage.input;
  outputTokens += r.usage.output;

  let outcome: Outcome;
  let detail = "";

  if (!r.answer) {
    outcome = "unparseable";
  } else if (q.expectAbstain) {
    // The only correct behaviour is to decline.
    outcome = r.answer.status === "not_in_knowledge_base" ? "correct" : "invented";
    if (outcome === "invented" && r.answer.status === "answered") {
      detail = r.answer.answer.slice(0, 90).replace(/\s+/g, " ");
    }
  } else if (r.answer.status === "not_in_knowledge_base") {
    outcome = "over-abstained";
  } else if (r.uncited) {
    // An unsourced claim about a club. The schema cannot forbid it, so
    // it is a first-class failure here.
    outcome = "uncited";
  } else {
    const cited = r.answer.citations.map((c) => c.source);
    const text = r.answer.answer.toLowerCase();
    const sourceOk =
      q.expectSource === null ||
      q.expectSource.some((want) => cited.some((c) => c.includes(want)));
    const containsOk =
      !q.expectContains || q.expectContains.some((s) => text.includes(s.toLowerCase()));
    const absentOk = !q.expectAbsent || !q.expectAbsent.some((s) => text.includes(s.toLowerCase()));

    if (!sourceOk) {
      outcome = "wrong-source";
      detail = `cited ${cited.join(", ")}, expected one of ${q.expectSource!.join(" / ")}`;
    } else if (!containsOk) {
      outcome = "wrong-value";
      detail = `missing one of: ${q.expectContains!.join(" / ")}`;
    } else if (!absentOk) {
      outcome = "wrong-value";
      detail = `contains a value it should not: ${q.expectAbsent!.join(" / ")}`;
    } else {
      outcome = "correct";
    }
  }

  results.push({ id: q.id, outcome, detail, bad: r.badCitations.length });

  const mark =
    outcome === "correct" ? "✔" : outcome === "invented" ? "✖ INVENTED" : "✖";
  console.log(`${mark.padEnd(12)} ${q.id.padEnd(38)} ${detail}`);
  for (const b of r.badCitations) {
    console.log(`             ⚑ ${b.source} — ${b.why}`);
    console.log(`               "${b.quote.slice(0, 70).replace(/\s+/g, " ")}"`);
  }
}

// ── report ──────────────────────────────────────────────────────
const n = (o: Outcome) => results.filter((r) => r.outcome === o).length;
const answerable = cases.filter((q) => !q.expectAbstain).length;
const unanswerable = cases.length - answerable;
const badCitations = results.reduce((a, r) => a + r.bad, 0);

console.log(`\n${"═".repeat(70)}`);
console.log(`correct                ${n("correct")}/${cases.length}`);
if (answerable) {
  console.log(`  wrong source         ${n("wrong-source")}`);
  console.log(`  wrong value          ${n("wrong-value")}`);
  console.log(`  over-abstained       ${n("over-abstained")}   (could have answered, didn't)`);
  console.log(`  uncited              ${n("uncited")}   (answered with no source at all)`);
}
if (unanswerable) {
  const invented = n("invented");
  console.log(
    `\nINVENTION RATE         ${invented}/${unanswerable}  ` +
      `(${Math.round((invented / unanswerable) * 100)}%) — answered when nothing could`,
  );
}
console.log(`bad citations          ${badCitations}   (quote not found in the cited source)`);

// Cost. Haiku 4.5 = $1/M in, $5/M out. Opus 5 = $5/$25.
const price = MODEL.includes("haiku") ? { in: 1, out: 5 } : { in: 5, out: 25 };
const usd = (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out;
console.log(
  `\ntokens                 ${inputTokens.toLocaleString()} in / ${outputTokens.toLocaleString()} out`,
);
console.log(
  `cost                   $${usd.toFixed(4)} total · $${(usd / cases.length).toFixed(5)} per question`,
);
console.log("");
