# Knowledge Retrieval

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 9

What we built to answer questions from the club's documents, what it measured, and — the part that matters — the specific conditions under which we would replace it.

---

## The decision

**No vector database. No embeddings. No chunking. The whole corpus goes in the prompt.**

Structured facts — every fee, limit, date and opening time — bypass retrieval entirely and are exposed as tools.

That is the architecture. It took an afternoon.

---

## Why: the arithmetic, before the opinion

| | |
|---|---|
| Narrative corpus | ~4,200 words ≈ **6,000 tokens** |
| Claude Haiku 4.5 context window | **200,000 tokens** |
| Share of one request | **3%** |

Cost, measured rather than estimated:

| | |
|---|---|
| Per question | **$0.0086** |
| At ~5 knowledge questions/day | **~$16/year** |
| With retrieval cutting context 6× | ~$3/year |

**Retrieval would save about thirteen dollars a year.** Against that: chunking decisions, a chunk-boundary bug class that splits a rule into two half-truths, an index to keep in step with the documents, and a new failure mode where the right passage simply isn't retrieved.

The spectrum runs prompt-stuffing → keyword → structured lookup → semantic → hybrid+rerank. Teams routinely start at position four out of habit and spend a month debugging retrieval quality on a corpus that would have fitted in a prompt.

> **Earn your way rightward.** The trigger is a *measured failure* of the simpler thing, never a hunch.

---

## What it measures

```
accuracy         20/21   worst of three runs
invention rate   0/15    across all three runs
bad citations    0–1
cost             $0.0086 per question
```

Five of the twenty-one questions are **unanswerable** — dogs, weddings, an electric-bike charging point, a visitor green fee that exists one file away from a tempting wrong answer. Fifteen opportunities to invent a plausible golf club policy; none taken.

That number only exists because unanswerable questions are in the set. **An eval containing only answerable questions cannot distinguish a knowledgeable agent from a fluent one**, and will quietly optimise for confident invention.

### How it is asserted

Answers are prose and prose cannot be compared. Sources can:

| Assertion | Deterministic? | Treatment |
|---|---|---|
| Cited the right source | yes | **gate** |
| Abstained when nothing could answer | yes | **gate** |
| Citation quote verifies against the source | yes | **gate** |
| Quoted a value it should not have | yes | **gate** |
| The answer contains a particular phrase | **no** | **report only** |

That last row was learned the hard way — see *Seven assertion errors* below.

---

## The split that did more than retrieval ever could

Every fact was sorted by one question:

> **Could two reasonable people read this and disagree about the answer?**
> No → structured. One right value. YAML, exposed as a tool.
> Yes → narrative. Prose, retrieved, cited.

Applied to the club's rules, **every single one** turned out structured:

| Rule | |
|---|---|
| 6 weeks maximum advance booking | `booking-rules.yaml` |
| 2 live bookings · 2 guests per booking · 6 per month | `booking-rules.yaml` |
| $20 guest fee · $15 late cancellation · 24h boundary | `fees.yaml` |
| Competition window, opening hours | `booking-rules.yaml`, `hours.yaml` |

So the part of *"what does my membership include?"* that members actually ask about — how many guests, how much, how far ahead — **needs no retrieval at all**. It is a tool call with exactly one right answer, and it is testable.

What remains for retrieval is the genuinely narrative: dress-code judgement, etiquette, procedures, the *why*.

**Getting this split right did more for accuracy than any retrieval tuning could have.**

---

## What actually went wrong — and none of it was retrieval

Four defects were found by one person typing at the agent while the eval was passing 20/20.

### 1. A stale document beat the authoritative data, on a booking rule

```
booking-rules.yaml   (authoritative)  every Saturday 08:30–11:00
competition-rules.md (stale, 2023)    first and third Saturdays only
```

The agent used the document. A member was told the 2nd and 4th Saturdays were bookable; they are closed.

> **Specificity beat authority.** "First and third Saturdays" is detailed and confident. "saturday" is terse. The model trusted the one that sounded better informed — and detail is exactly what goes stale first.

Fixed at the **corpus**, not the prompt: the window is now stated once, in the authoritative place. The rule that decided it:

**Eliminate conflicts where the blast radius is high. Keep them where you want to test judgement.** A wrong guest fee is a conversation; a wrong booking rule is a member driving to a closed tee sheet.

### 2. YAML comments are invisible to the model

```yaml
competition:
  # Tee sheet closed to general booking during these windows   ← dropped by the parser
  - day: saturday
```

The model receives the *parsed* file. It saw `{"day":"saturday","from":"08:30","to":"11:00"}` and could not tell whether that was when competitions happen or when booking is shut — so it preferred the document that spelled it out.

This was systemic: `fees.yaml` explained "per guest, per round" and that the fee had risen from $15, both in comments, both invisible.

**Meaning now lives in the data**, as a `meaning:` key. Documentation written for a human reading the file is not read by the model.

### 3. The abstention branch was an uncited escape hatch

Citations are required on answers. Nothing was required on the `suggestion` field — so a decline could still deliver facts, unsourced and unverified, through the branch designed to be the safe one.

Now constrained to routing (*who* to ask, *what* to ask them) with a `contact` enum, and the eval flags any suggestion carrying a figure.

### 4. Staleness never reached the member

The prompt asked the model to mention an overdue source. It answered a booking question from a 2023 document and said nothing.

Moved to code: cited sources are checked against their review dates and the warning is appended by the runner.

> **Asking a model to remember something is a request. Computing it is a guarantee.**

### The pattern

Not one of these four was a retrieval problem. Three were **data modelling** and one was **enforcement placement**. On a corpus this size, retrieval technique is not where the accuracy is.

---

## Seven assertion errors

The eval was wrong about the agent seven times in one day: a crude forbidden-value check that would have failed the *best* answer, two wrong expected sources, a question phrased too specifically to surface the conflict it tested, a demand for ceremony the corpus did not require, and finally `"three hours fifteen"` versus `"three hours **and** fifteen minutes"` — after the accepted list had already been widened to seven variants.

> **You cannot enumerate the ways a sentence can be phrased.**

Hence the gate/report split in the table above. Gating on a fuzzy signal is how a suite gets switched off.

---

## Prompt caching

The corpus is the ideal caching prefix: identical every call, at the front, never varying mid-conversation. Cache reads cost ~0.1× base price, roughly a 60% saving within a conversation.

Worth contrasting with project 01, where caching is **impossible** — `STAGE_TOOLS` changes the tool set at every transition, tools render at position 0, so every stage invalidates the prefix. There, capability enforcement and caching were the same lever pulled opposite ways. Here they are not in tension at all.

At ~5 questions a day the cache is usually cold *between* conversations (default TTL 5 minutes), so the saving is real but bounded.

---

## When we would move right

Concrete, so this can be checked rather than argued about.

| # | Trigger | Threshold | Move to |
|---|---|---|---|
| 1 | **Corpus size** | Narrative exceeds **~40k tokens** (20% of Haiku's window, leaving room for conversation and tools) | Keyword retrieval (SQLite FTS5) |
| 2 | **Measured accuracy fall** | Golden-set accuracy drops below **90%** *and* the failures are the model missing a passage that is present in context | Keyword retrieval, then measure again |
| 3 | **Cost** | Stuffing exceeds **10% of total agent cost** | Keyword retrieval |
| 4 | **Paraphrase failure** | Keyword retrieval is in place and misses **>10%** of golden-set questions because the member's words don't match the document's | Embeddings — and only here |
| 5 | **Latency** | Time-to-first-token becomes user-visible in a conversational surface | Retrieval, or caching first |

Note that **embeddings appear only at trigger 4**, and trigger 4 cannot be reached without first having built keyword retrieval and measured it failing. That ordering is deliberate.

None of the five is met today. Corpus is 6k tokens against a 40k trigger; accuracy is 95%+ against a 90% trigger; cost is ~$16/year.

### What would *not* be a trigger

- The corpus growing in *number of files* while staying small in tokens
- A supplier saying that this is how RAG is done
- Anticipating growth that has not happened
- A single failed question, before it has been reproduced as a rate

---

## Not built: the keyword comparison

Day 9 asks for FTS5 retrieval measured on the same twenty questions. **It has not been built**, and this note should say so rather than imply a comparison that did not happen.

The reasoning: trigger 1 is not close, trigger 3 is $13/year, and the four real defects were all corpus quality. Building an index to save thirteen dollars is the exact over-engineering this document argues against.

What is lost by not building it is a **measured** number where there is currently a prediction. So the prediction is recorded here, falsifiable:

> With top-5 chunk retrieval, we expect accuracy to **fall**, concentrated on questions needing two documents at once. The clearest case is *"can I wear jeans?"*, which requires `dress-code.md` (the ban) **and** `bar-and-clubhouse.md` (the spike bar exception) in the same answer. Retrieval that returns one and not the other produces a confident half-truth — worse than the current behaviour, which surfaces both.
>
> We expect cost per question to fall roughly 6×, from $0.0086 to ~$0.0014.

If the corpus reaches trigger 1, build it and check that prediction before trusting it.

---

## When *not* to do any of this

If the answers are all fields — fees, dates, statuses, limits — you do not need a knowledge system at all. You need tools and a schema.

The retrieval question only arises for content that genuinely has to be *read*: rules requiring judgement, procedures, explanation. On this project that turned out to be a much smaller share of the corpus than it first appeared, and noticing that was worth more than any retrieval decision downstream of it.
