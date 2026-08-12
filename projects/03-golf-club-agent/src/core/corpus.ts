// Loading the knowledge.
//
// Two kinds, treated completely differently, and the split is the
// architecture:
//
//   structured/*.yaml   → TOOLS. Exact values. Bypasses retrieval
//                         entirely. If the answer is a number, a date,
//                         a status or a limit, it lives here.
//
//   knowledge/*.md      → text the model reads. Only genuinely
//                         narrative content: rules needing judgement,
//                         procedures, the "why".
//
// Every narrative document carries front matter with an OWNER. That is
// not decoration — the corpus contains real authority conflicts (the
// bar manager and the pro shop both have legitimate say over dress
// code, in different rooms), and an agent that resolves one silently is
// answering a question the club has never settled. Knowing the owner
// lets it say who decides instead.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = new URL("../../", import.meta.url).pathname;

export interface Document {
  /** Filename — the citation key. */
  id: string;
  title: string;
  owner: string;
  lastUpdated: string;
  reviewDue: string;
  body: string;
}

/** Front matter is deliberately simple: this is not a CMS. */
function parseDocument(id: string, raw: string): Document {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${id}: no front matter`);
  const meta = parseYaml(m[1]!) as Record<string, string>;
  return {
    id,
    title: meta.title ?? id,
    owner: meta.owner ?? "unknown",
    lastUpdated: meta.last_updated ?? "unknown",
    reviewDue: meta.review_due ?? "unknown",
    body: m[2]!.trim(),
  };
}

export function loadDocuments(): Document[] {
  const dir = join(ROOT, "knowledge");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => parseDocument(f, readFileSync(join(dir, f), "utf8")));
}

export function loadStructured(): Record<string, unknown> {
  const dir = join(ROOT, "structured");
  const out: Record<string, unknown> = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    out[f] = parseYaml(readFileSync(join(dir, f), "utf8"));
  }
  return out;
}

/**
 * Is this document overdue for review?
 *
 * A confidently-cited stale answer is worse than no answer — green fees
 * change annually and the agent quoting last year's is a real customer
 * complaint, not a hypothetical one.
 */
export function isStale(doc: Document, now = new Date()): boolean {
  const due = new Date(doc.reviewDue);
  return !Number.isNaN(due.getTime()) && due < now;
}

/** The whole narrative corpus, as one string, for prompt stuffing. */
export function stuffAll(docs: Document[]): string {
  return docs
    .map(
      (d) =>
        `<document id="${d.id}" owner="${d.owner}" last_updated="${d.lastUpdated}"` +
        `${isStale(d) ? ' STALE="true"' : ""}>\n${d.body}\n</document>`,
    )
    .join("\n\n");
}
