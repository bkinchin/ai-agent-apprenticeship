# Day 11 — Memory

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can design cross-session memory that improves the experience without creating a correctness, privacy, or trust liability — and you know when not to build it at all.

---

## Concepts

### Memory is not state

| | State (day 2) | Memory |
|---|---|---|
| Scope | One session | Across sessions |
| Lifetime | Minutes | Months |
| Source | The conversation | Inferred from conversations |
| Truth | Reliable | **Inferred — may be wrong** |
| Failure | Confusion | Confidently wrong, forever |

That fourth row is the whole risk. State is what was said. Memory is what you *concluded*, and conclusions can be wrong, stale, or based on a misunderstanding — and then they persist and influence every future conversation.

**Memory is a database of unverified assertions that you inject into every future prompt.** Design it with that sentence in mind.

### The three types

| Type | Example | Store | Trust |
|---|---|---|---|
| **Factual** | Handicap 12; plays Saturdays | Structured, typed | Medium — verify against systems |
| **Preference** | Prefers email; likes early tee times | Structured, typed | Medium — cheap if wrong |
| **Episodic** | "Complained about bunkers in May, resolved" | Summarised events | Low — lossy |

### The rule that prevents most memory disasters

**If a system of record knows it, don't remember it — look it up.**

The member's handicap lives in the handicap system. Their membership category lives in the CRM. Caching those in "memory" means serving a stale handicap with confidence. Memory is for what *no system records*: preferences expressed in conversation, context about their situation, the history of your relationship with them.

This single rule eliminates the majority of memory bugs. Most "memory" features people build are badly-implemented caches.

### Write policy — the hard part

Deciding what to remember is harder than storing it.

**Don't write on every turn.** You get a store full of noise, contradictions, and things the member said once in irritation.

Candidate policies:

1. **Explicit only** — "remember that I prefer morning slots." Highest precision, lowest recall, zero surprise. **Start here.**
2. **End-of-session extraction** — one structured extraction call at session end. Good balance; this is the usual production answer.
3. **Confidence-gated** — extract continuously, write only above a threshold. Needs a calibrated confidence, which you probably don't have.
4. **Human-confirmed** — the agent proposes, the member confirms. Right for anything consequential.

Every memory needs provenance:

```ts
interface Memory {
  id: string;
  subjectId: string;                  // WHO — always scoped
  type: "factual" | "preference" | "episodic";
  key: string;                        // "preferred_tee_time"
  value: unknown;
  confidence: number;
  source: { sessionId: string; turnIndex: number; quote: string };  // WHY
  createdAt: string;
  lastConfirmedAt: string;
  expiresAt?: string;                 // decay
}
```

The `source.quote` field is non-negotiable. When a memory turns out to be wrong, you must be able to see what was said. It is also what lets you show the member *why* you think something.

### Contradiction and decay

New information contradicts old. Options: last-write-wins (simple, sometimes wrong), confidence-weighted (needs good confidence), keep both and let the model see the conflict (honest — often best), or ask the member (best for anything that matters).

Memories go stale. A preference from three years ago is a guess. Attach a TTL by type — preferences 12 months, episodic 6, factual until contradicted — and treat expiry as a feature, not a cleanup job.

### Retrieval and the injection budget

Do not inject everything you know. Retrieve by relevance to the current conversation, cap it — 5 to 10 memories, a few hundred tokens — and prefer recent and high-confidence.

Format it so the model knows it is **fallible**:

```
What you know about this member (from previous conversations — may be
out of date; verify anything important before acting on it):
- Prefers tee times before 09:00 (mentioned 3 Mar 2026)
- Usually plays with a group of 4 (observed 6 times)
- Raised a complaint about bunker maintenance in May 2026 (resolved)
```

The parenthetical dates and the caveat materially change model behaviour. Presenting memory as fact makes the model act on stale beliefs.

### The trust and privacy dimension

Memory is where an agent goes from useful to creepy. Design for:

- **Transparency** — "what do you remember about me?" must be answerable, in plain English
- **Correction** — the member can fix a wrong memory
- **Deletion** — the member can delete it, and it must actually be gone, including from backups and traces
- **Scoping** — memory is bound to a subject and **never leaks across members**. Test this explicitly; it is the catastrophic failure mode.
- **Sensitivity** — some things should never be stored even if said. Health, financial distress, and third-party information need an explicit exclusion list.

Under GDPR, inferred memories are personal data. Right of access, rectification, and erasure all apply. Build the three endpoints on day one — retrofitting them is painful.

### When not to build memory

If sessions are rare and independent, if the value is small, if the systems of record already hold what matters — **don't**. Memory adds a whole class of failure for a marginal experience gain. "We considered memory and decided against it because…" is a strong answer, not a gap.

---

## Architecture

```
                  session ends
                       │
                       ▼
            ┌────────────────────┐
            │ Extraction (LLM)   │  structured output, typed,
            │ + provenance       │  confidence-scored
            └─────────┬──────────┘
                      ▼
            ┌────────────────────┐
            │  Write policy      │  sensitive? duplicate?
            │  + contradiction   │  contradicts existing?
            └─────────┬──────────┘
                      ▼
            ┌────────────────────┐
            │   Memory store     │  subject-scoped, TTL'd,
            │   (SQLite)         │  auditable, deletable
            └─────────┬──────────┘
                      │
   next session ──▶ retrieve (relevance, cap 8)
                      │
                      ▼
              context assembly (day 2)
                      │
                      ▼
                    model
```

Note it plugs into the day-2 context assembler. That seam is now earning its keep.

---

## Exercise

**1. Decide what to remember — before coding.** Write the list in `docs/architecture/memory-design.md`. For each item: why is it not in a system of record? What's the cost of it being wrong? How long is it valid?

**2. Write the exclusion list.** What must never be stored. Be specific.

**3. Build the store** with the full `Memory` shape, subject-scoped, in SQLite.

**4. Implement explicit memory first** — "remember that I…". Ship the simple version, feel it work.

**5. Add end-of-session extraction** with structured output, confidence, and a required source quote.

**6. Implement contradiction handling.** Pick a strategy, justify it in your doc, and test it: give the agent contradicting preferences in two sessions and see what it does.

**7. Implement decay** with type-based TTLs.

**8. Build retrieval with a hard budget** and the fallible-framing format above.

**9. Build the three transparency operations:** "what do you know about me?", "that's wrong, it's X", "forget that". All must work conversationally. Deletion must be verifiable.

**10. Test cross-member leakage explicitly.** Two members, similar conversations. Assert zero leakage. **Write this as an automated test that stays in the suite forever.**

**11. Measure the value.** Run 5 golden-set scenarios with memory on and off. Did it actually improve anything? Be honest — if it didn't, that is a legitimate and interesting finding.

**12. Break it deliberately.** Plant a wrong memory ("member's handicap is 4" when it's 22). Run a competition-entry conversation. Watch what a confident wrong memory does. Document it.

---

## Deliverable

- [ ] `docs/architecture/memory-design.md` — what, why, TTL, exclusions
- [ ] Subject-scoped memory store with full provenance
- [ ] Explicit + end-of-session extraction
- [ ] Contradiction handling, tested
- [ ] Decay with type-based TTLs
- [ ] Budgeted retrieval with fallible framing
- [ ] Show / correct / delete, all working conversationally
- [ ] **Automated cross-member leakage test**
- [ ] Memory on/off value measurement
- [ ] `journal/day-11.md` — including the planted-wrong-memory result

---

## Reflection

1. What did the memory on/off comparison show? Was it worth the complexity? Answer honestly.
2. What did the wrong handicap do to the conversation? How would you have caught it in production?
3. Which of your memories should really be a lookup? Move them and say why.
4. A member asks "what do you know about me?" Write the actual response. Would it feel helpful or unsettling?
5. GDPR erasure request. List everywhere the data lives — memory store, traces, eval sets, logs, backups, model provider retention. How long does it take you?

---

## Interview Question

> "How would you give a customer-service agent memory across conversations?"

The strongest answers begin by asking whether it should exist at all, and by separating memory from lookup — if the CRM knows it, read the CRM. Then: extract at session end rather than per turn; store provenance including the quote; scope to a subject and test leakage; TTL by type; budget what's injected and frame it as fallible; handle contradiction explicitly; build show/correct/delete as product features because GDPR requires them; and never let memory be the source of truth for anything actionable. Depth marker: naming the specific failure where a stale confident memory causes a wrong action, and describing how you'd detect it. Weak answers describe a vector store of conversation summaries with no write policy and no deletion story.

---

**Next:** [Day 12 — Human escalation](day-12.md)
