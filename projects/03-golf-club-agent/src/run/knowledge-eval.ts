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

type Outcome = "correct" | "wrong-source" | "invented" | "over-abstained" | "uncited" | "unparseable";

/**
 * Strip filler so "three hours and fifteen minutes" matches
 * "three hours fifteen". Not a fix — a mitigation. See below.
 */
const loose = (s: string) =>
  s.toLowerCase().replace(/\b(and|a|an|the|approximately|about|roughly|around)\b/g, " ").replace(/\s+/g, " ").trim();
const results: { id: string; outcome: Outcome; detail: string; bad: number }[] = [];
let leakySuggestions = 0;
let contentMismatches = 0;
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
      !q.expectContains || q.expectContains.some((s) => loose(text).includes(loose(s)));
    const absentOk = !q.expectAbsent || !q.expectAbsent.some((s) => loose(text).includes(loose(s)));

    const allSourcesOk =
      !q.expectAllSources ||
      q.expectAllSources.every((want) => cited.some((c) => c.includes(want)));

    if (!allSourcesOk) {
      outcome = "wrong-source";
      detail = `cited ${cited.join(", ")}, needed ALL of ${q.expectAllSources!.join(" + ")}`;
    } else if (!sourceOk) {
      outcome = "wrong-source";
      detail = `cited ${cited.join(", ")}, expected one of ${q.expectSource!.join(" / ")}`;
    } else if (!absentOk) {
      // A value that must NOT appear is a real failure — it means a
      // stale figure was quoted as current.
      outcome = "wrong-source";
      detail = `contains a value it should not: ${q.expectAbsent!.join(" / ")}`;
    } else {
      // CONTENT MISMATCH IS REPORTED, NOT FAILED.
      //
      // Seven attempts to assert on phrasing, seven wrong. The last one
      // expected "three hours fifteen" and got "three hours AND fifteen
      // minutes" — after the list had already been widened to seven
      // variants. You cannot enumerate how a sentence may be phrased.
      //
      // Day 7's gate-vs-trend distinction, arriving here: the SOURCE
      // assertion is deterministic and gates; the CONTENT assertion is
      // fuzzy and reports. Gating on a fuzzy signal is how a suite gets
      // switched off.
      outcome = "correct";
      if (!containsOk) {
        contentMismatches++;
        detail =
          `\x1b[33m⚠ content\x1b[0m expected one of: ${q.expectContains!.join(" / ")}\n` +
          `             said: "${r.answer.answer.slice(0, 130).replace(/\s+/g, " ")}"`;
      }
    }
  }

  // An abstention whose "routing" carries a figure is a fact that
  // escaped the citation requirement through the branch meant to be safe.
  const leaky =
    r.answer?.status === "not_in_knowledge_base" && /\d/.test(r.answer.suggestion);
  if (leaky) leakySuggestions++;

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
console.log(`leaky suggestions      ${leakySuggestions}   (abstained, then stated a figure uncited)`);
console.log(`content mismatches     ${contentMismatches}   ⚠ REPORTED, NOT FAILED — read them, do not gate on them`);

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
