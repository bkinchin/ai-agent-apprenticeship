# Day 9 — Knowledge Systems

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can get an agent to answer questions from a body of documents accurately and with citations — and you can explain why you did **not** start with a vector database.

---

## Concepts

### The problem

The model knows the internet up to a date. It does not know your membership categories, your green fees, or your dress code. Answering those from parametric knowledge produces confident invention, which is the worst possible failure for a customer-facing system.

So knowledge must be **retrieved and injected**, and answers must be **attributable**.

### Retrieval is a spectrum, and you should start at the left

| Approach | Setup | Works when | Cost |
|---|---|---|---|
| **Stuff it all in the prompt** | Minutes | Corpus < ~30k tokens | Tokens per call |
| **Keyword / BM25 search** | Hours | Distinctive vocabulary | Trivial |
| **Structured lookup** | Hours | The answer is a *field*, not a passage | Trivial |
| **Semantic (embeddings)** | Days | Paraphrase-heavy, large corpus | Infra + embedding cost |
| **Hybrid + rerank** | Weeks | Large, high-stakes | Significant |

A golf club handbook is maybe 15,000 words. **You can put the whole thing in the prompt.** No chunking, no embeddings, no vector database, no chunk-boundary bugs, and perfect recall.

Enterprise teams routinely skip to row four out of habit, then spend a month debugging retrieval quality on a corpus that would have fitted in a prompt. Do not be that team. Today's real lesson is *earn your way rightward*.

The trigger for moving right is a measured failure of the simpler approach — never a hunch.

### Structured beats unstructured, always

The single biggest retrieval mistake is putting structured data in prose.

```
✗ Handbook paragraph: "Full members pay £1,450 annually, with a £200
  joining fee, while country members pay £890..."
  → retrieval finds it, the model may misread it, no way to test it

✓ fees.yaml:
    full:     { annual: 1450, joining: 200, guests_per_month: 4 }
    country:  { annual: 890,  joining: 200, guests_per_month: 2 }
  → a `get_membership_fees(category)` tool. Exact. Testable. Auditable.
```

**If the answer is a number, a date, a status, or a rule, it belongs in a tool — not in a document.** Retrieval is for genuinely narrative content: policies, explanations, procedures, the "why".

Getting this split right will do more for the golf club agent's accuracy than any retrieval tuning.

### Chunking, when you need it

Chunks are the retrieval unit. Bad chunking is the most common cause of bad RAG, and it is upstream of everything else.

- **Chunk on document structure** (headings, sections), never on a fixed character count. A rule split across two chunks becomes two half-truths.
- **Keep the heading path in the chunk text**: `Membership > Country Membership > Guest Policy` — it helps both retrieval and the model.
- **Overlap** by a couple of sentences to survive boundaries.
- **Metadata is not optional**: source document, section, last updated, audience, version.
- **Small enough to be precise, large enough to be complete.** 200–500 words for prose.

### Citations are a requirement, not a feature

Every knowledge-derived claim must carry its source. This gives you:

- **Verifiability** — the member can check
- **Debuggability** — was the answer wrong, or the document?
- **Trust** — cited answers are believed appropriately
- **Evaluability** — you can assert on retrieved chunk IDs deterministically

Enforce it structurally:

```ts
const KnowledgeAnswer = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("answered"),
    answer: z.string(),
    citations: z.array(z.object({ sourceId: z.string(), quote: z.string() })).min(1),
  }),
  z.object({
    status: z.literal("not_in_knowledge_base"),
    suggestion: z.string(),
  }),
]);
```

A cited answer *requires* at least one citation, by schema. And there is an in-band way to say "I don't know" — which the model will otherwise never take.

### "I don't know" is a feature

An agent that answers everything is an agent that invents. Make abstention:

- **Available** — the schema branch above
- **Rewarded** — golden-set cases where the correct answer is `not_in_knowledge_base`
- **Graceful** — "I can't find that in the club handbook — I'll pass you to the membership secretary" is a *good* outcome

Include unanswerable questions in your golden set. If your eval only contains answerable questions, you have optimised for confident invention.

### Freshness

Documents go stale, and a confidently-cited stale answer is worse than no answer. Track `last_updated` on every source, surface it, and flag anything past its review date. Green fees change annually; the agent quoting last year's is a real customer complaint.

---

## Architecture

```
   sources/                      ┌──────────────────────┐
   ├── handbook.md               │      Ingestion       │
   ├── competition-rules.md ────▶│  parse → chunk by    │
   ├── dress-code.md             │  structure → enrich  │
   └── faq.md                    │  with metadata       │
                                 └──────────┬───────────┘
   structured/                              ▼
   ├── fees.yaml  ──▶ tools           knowledge store
   └── hours.yaml                     (JSON / SQLite FTS)
                                            │
   query ──▶ retrieve (top-k) ──────────────┘
              │
              ▼
        context assembly  ──▶  model  ──▶  cited answer
              (day 2)                       (schema-enforced)
```

Note that structured data bypasses retrieval entirely and becomes tools. That split is the architecture.

---

## Exercise

**1. Build the corpus.** Write realistic golf club content in `projects/03-golf-club-agent/knowledge/`: membership handbook (categories, fees, joining, guests), competition rules, dress code, course etiquette, an FAQ. Aim for 4,000–6,000 words. **Include contradictions and gaps on purpose** — real corpora have them, and your agent must survive them.

**2. Do the structured/unstructured split.** Extract every fee, date, opening time, and hard limit into YAML. Leave narrative in markdown. Document your rule for deciding.

**3. Start with prompt stuffing.** Put the whole corpus in the system prompt. Build a 20-question golden set. **Measure accuracy.** This is your baseline and, quite possibly, your shipping answer.

**4. Now build keyword retrieval.** SQLite FTS5. Chunk on headings. Retrieve top 5. Measure the same 20 questions. Compare accuracy *and* tokens per query.

**5. Analyse the difference.** Where did retrieval lose? (Usually: questions needing two sections.) Where did it win? (Cost.) Write this up — it is the day's insight.

**6. Enforce citations** with the discriminated union. Verify quotes actually appear in the cited source; a citation the model invented is worse than none.

**7. Add abstention cases.** Five questions the corpus cannot answer. Measure how often the agent invents rather than abstaining. Fix it. Re-measure.

**8. Add freshness metadata** and a staleness warning.

**9. Write the note.** `docs/architecture/knowledge-retrieval.md`: what you built, what you measured, and — specifically — **the conditions under which you would move to embeddings**. Be concrete: corpus size, query type, measured failure rate.

---

## Deliverable

- [ ] 4,000+ word corpus with deliberate gaps and contradictions
- [ ] Structured data extracted to YAML and exposed as tools
- [ ] Both approaches implemented and **measured on the same 20 questions**
- [ ] Schema-enforced citations with quote verification
- [ ] 5 abstention cases, with a measured invention rate before and after
- [ ] Freshness metadata + staleness warning
- [ ] `docs/architecture/knowledge-retrieval.md` including your trigger for embeddings
- [ ] `journal/day-09.md`

---

## Reflection

1. What were your two accuracy numbers? Did retrieval beat stuffing? At what corpus size does the answer flip?
2. What fraction of your golden-set questions were answerable from *structured* data alone? What does that suggest about where to invest?
3. Your corpus contains a contradiction. What did the agent do? What *should* it do?
4. How would a member notice a stale answer before you do? What does that cost?
5. A supplier proposes a vector database. Write the three questions you'd ask before agreeing.

---

## Interview Question

> "Walk me through how you'd build knowledge retrieval for a customer-service agent."

The signal is whether they start with embeddings. Strong answers: characterise the corpus first (size, structure, change rate); split structured facts into tools and leave only narrative for retrieval; start with the simplest thing that could work and measure it; chunk on document structure with metadata; enforce citations schematically; make abstention available and reward it in evals; and treat the move to semantic retrieval as a decision justified by measured failure. Bonus depth: retrieved content is untrusted input and is a prompt-injection vector — a poisoned document is an attack. Weak answers describe a RAG pipeline diagram with no mention of measurement.

---

**Next:** [Day 10 — Business tools](day-10.md)
