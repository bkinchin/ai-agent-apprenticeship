// Asking a question of the corpus, with citations enforced by schema.
//
// Two things must be structural rather than requested:
//
//   1. An answered response REQUIRES at least one citation.
//   2. There is an in-band way to say "I don't know". Without one the
//      model has no legal way to decline, so it invents — fluently, and
//      about a golf club it has never heard of.
//
// THE FIRST ATTEMPT WAS A DISCRIMINATED UNION, and the API refused it:
//
//   400  output_config.format.schema: For 'anyOf', '$defs' is not supported
//
// Zod emits a discriminated union as `anyOf` with `$defs` references,
// and structured outputs do not accept that. So `.min(1)` on the
// answered branch — the mechanism that was going to make an uncited
// answer impossible — is not available at the schema layer.
//
// The guarantee does not get dropped. It moves DOWN A LAYER: a flat
// object the API accepts, plus code that rejects an "answered" carrying
// no citations. Still structural, still not a request to the model,
// just enforced one step later.
//
// Worth noticing as a pattern rather than an annoyance. Week 1 ranked
// six enforcement mechanisms by strength; this is the same exercise —
// when the strongest available mechanism turns out not to exist on this
// platform, you move to the next one down and say so, rather than
// quietly falling back to asking nicely in the prompt.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { isStale, stuffAll, type Document } from "./corpus.js";

const client = new Anthropic();
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

/** Flat, because the API will not take a union. See the note above. */
export const Answer = z.object({
  status: z
    .enum(["answered", "not_in_knowledge_base"])
    .describe("not_in_knowledge_base when the knowledge below does not answer it."),
  answer: z
    .string()
    .describe("The answer for a club member. Empty string when abstaining."),
  citations: z
    .array(
      z.object({
        source: z.string().describe("Filename of the document or YAML file used."),
        quote: z.string().describe("The exact text relied on. Must appear verbatim."),
      }),
    )
    .describe("Required when status is answered. Empty when abstaining."),
  reason: z
    .string()
    .describe(
      "When abstaining: one sentence on what is missing from the knowledge. " +
        "Empty when answering.",
    ),
  contact: z
    .enum([
      "pro_shop",
      "club_secretary",
      "bar_manager",
      "competition_secretary",
      "handicap_secretary",
      "none",
    ])
    .describe("Who the member should ask. 'none' when answering."),
  suggestion: z
    .string()
    .describe(
      "ROUTING ONLY — who to ask and what to ask them. Never information. " +
        "Empty when answering.",
    ),
});

export type Answer = z.infer<typeof Answer>;

/**
 * Which cited sources are past their review date.
 *
 * The system prompt asks the model to mention staleness. It did not —
 * it answered a booking question from a document three years overdue
 * and said nothing. Asking a model to remember something is a request;
 * this is the guarantee.
 */
export interface AskResult {
  answer: Answer | null;
  /** Citations whose quote could NOT be found in the cited source. */
  badCitations: { source: string; quote: string; why: string }[];
  /** Cited documents past their review date. Code appends the warning. */
  staleSources: { id: string; reviewDue: string }[];
  /**
   * The model answered but cited nothing.
   *
   * The schema cannot forbid this (the API rejects discriminated
   * unions), so it is caught here instead. An uncited answer is not a
   * lesser answer — it is an unsourced claim about a club, which is the
   * exact failure this whole mechanism exists to prevent.
   */
  uncited: boolean;
  usage: { input: number; output: number };
}

function systemPrompt(docs: Document[], structured: Record<string, unknown>): string {
  return [
    "You answer questions for members of a golf club, using ONLY the",
    "knowledge below. You know nothing else about this club.",
    "",
    "TWO KINDS OF KNOWLEDGE, and they are not equal:",
    "",
    "1. STRUCTURED DATA — fees, limits, dates, opening hours. These are",
    "   the authoritative values. Where a document and the structured",
    "   data disagree, THE STRUCTURED DATA IS CORRECT and the document",
    "   is out of date. Say so if it matters to the member.",
    "",
    "   State a value FROM THE STRUCTURED DATA plainly. Do not soften it",
    "   because a document expresses doubt — a document saying 'check",
    "   with the pro shop' is why the structured data exists, not a",
    "   reason to doubt it. 'The guest fee is $20; the FAQ page is out of",
    "   date' is correct. 'It is $20 but may have changed' turns a",
    "   certain answer into an uncertain one.",
    "",
    "   This applies ONLY to values in the structured data. It is not a",
    "   licence to be confident about anything else.",
    "",
    "   SPECIFICITY IS NOT AUTHORITY. A document giving more detail than",
    "   the structured data has not overridden it — it is more likely to",
    "   be out of date, because detail is what goes stale first. Where a",
    "   document's detail contradicts a structured value, the structured",
    "   value wins and the extra detail is suspect.",
    "",
    "2. DOCUMENTS — rules needing judgement, procedures, explanations.",
    "",
    "Every document has an OWNER. Different parts of the club have",
    "genuine authority over different things: the pro shop owns the",
    "course, the bar manager owns the bar.",
    "",
    "When two documents from DIFFERENT OWNERS disagree, you must do all",
    "three of these, and the third is the one that gets forgotten:",
    "",
    "  1. Say what each document says",
    "  2. Say which applies where",
    "  3. NAME THE OWNER who decides the disputed case",
    "",
    "Do not reconcile them into a single settled rule of your own. 'Denim",
    "is banned except in the spike bar' sounds authoritative and is a",
    "synthesis you invented — the pro shop's document contains no such",
    "exception. 'The pro shop bans denim across the club; the spike bar",
    "sets its own standard and permits it — the Bar Manager decides for",
    "that room' is what the club can actually stand behind.",
    "",
    "A document marked STALE is past its review date. You may still use",
    "it — say that it may be out of date.",
    "",
    "WHEN YOU DECLINE, the suggestion field is ROUTING, NOT AN ANSWER.",
    "Say who to ask and what to ask them. Do NOT put facts there. The",
    "citation requirement applies to answers; anything you write in the",
    "suggestion carries no source, so a fact placed there is an unsourced",
    "claim wearing a helpful hat. 'Ask the Bar Manager about private hire'",
    "is right. 'The dining room and lounge can be hired' is an answer, and",
    "belongs in an answer with a citation or nowhere.",
    "",
    "If the knowledge does not answer the question, return",
    "not_in_knowledge_base. Do not reason from what a golf club is",
    "usually like. An invented policy that sounds plausible is the worst",
    "thing you can produce.",
    "",
    "ADJACENT IS NOT AN ANSWER. If the knowledge covers something",
    "similar but not the thing asked, that is not_in_knowledge_base —",
    "say what IS covered, and be clear the specific question is not.",
    "A member asking about weddings should not be told the private-hire",
    "policy as though it answered them.",
    "",
    "Every citation quote must be text you can see below, copied exactly.",
    "",
    "=== STRUCTURED DATA (authoritative) ===",
    renderStructured(structured),
    "",
    "=== DOCUMENTS ===",
    stuffAll(docs),
  ].join("\n");
}

/**
 * The structured data, rendered exactly once.
 *
 * The first version of this file sent `JSON.stringify(x, null, 2)` to
 * the model and verified quotes against `JSON.stringify(x)` — two
 * different strings. Every YAML citation was reported as invented. The
 * model had quoted precisely what it was shown.
 *
 * A detector that reports failures it cannot substantiate is worse than
 * no detector, so: render once, verify against the same thing.
 */
export const renderStructured = (structured: Record<string, unknown>): string =>
  JSON.stringify(structured, null, 2);

/**
 * Normalise for quote matching.
 *
 * Collapses whitespace and strips markdown emphasis — the model quotes
 * "the guest green fee" from a heading written "**the guest green
 * fee**" and is not wrong to.
 */
const flat = (s: string) =>
  s
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Verify every citation quote actually appears in its cited source.
 *
 * A citation the model invented is worse than no citation: it looks
 * like evidence and is not. This is the check that makes the whole
 * mechanism worth having.
 */
export function verifyCitations(
  answer: Answer,
  docs: Document[],
  structured: Record<string, unknown>,
): AskResult["badCitations"] {
  if (answer.status !== "answered") return [];
  const bodies = new Map(docs.map((d) => [d.id, flat(d.body)]));
  const structuredText = flat(renderStructured(structured));

  const bad: AskResult["badCitations"] = [];
  for (const c of answer.citations) {
    const q = flat(c.quote);
    if (c.source.endsWith(".yaml")) {
      // VERIFY THE FACTS, NOT THE FORMATTING.
      //
      // Verbatim quoting is the right check for prose and the wrong one
      // for structured data. Nobody quotes a YAML file: the model reads
      // {"friday_to_sunday": {"open": "11:00", "close": "23:00"}} and
      // writes "Friday to Sunday: 11:00-23:00", which is a faithful
      // citation and fails an exact-substring test.
      //
      // What actually needs proving is that the model did not invent a
      // VALUE. So check every number and time in the quote exists in the
      // structured data. A fabricated $25 guest fee still fails; a
      // reformatted true one does not.
      const values = c.quote.match(/\d[\d:.]*/g) ?? [];
      const missing = values.filter((v) => !structuredText.includes(v.toLowerCase()));
      if (values.length === 0) {
        bad.push({ ...c, why: "cited structured data but quoted no value" });
      } else if (missing.length > 0) {
        bad.push({ ...c, why: `value(s) not in structured data: ${missing.join(", ")}` });
      }
      continue;
    }
    const body = bodies.get(c.source);
    if (body === undefined) bad.push({ ...c, why: `no such document: ${c.source}` });
    else if (!body.includes(q)) bad.push({ ...c, why: "quote not found in that document" });
  }
  return bad;
}

export async function ask(
  question: string,
  docs: Document[],
  structured: Record<string, unknown>,
): Promise<AskResult> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(docs, structured),
    messages: [{ role: "user", content: question }],
    output_config: { format: zodOutputFormat(Answer) },
  });

  const answer = response.parsed_output ?? null;
  return {
    answer,
    badCitations: answer ? verifyCitations(answer, docs, structured) : [],
    staleSources:
      answer?.status === "answered"
        ? answer.citations
            .map((c) => docs.find((d) => d.id === c.source))
            .filter((d): d is Document => d !== undefined && isStale(d))
            .map((d) => ({ id: d.id, reviewDue: d.reviewDue }))
        : [],
    uncited: answer?.status === "answered" && answer.citations.length === 0,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
