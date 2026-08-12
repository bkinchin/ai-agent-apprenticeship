# Day 9 — Knowledge Systems

**Project:** 03-golf-club-agent · **Deliverable:** corpus, structured split, 21-question golden set, cited answers, `knowledge-retrieval.md`

The day whose objective is *"explain why you did **not** start with a vector database."* The honest version turned out stronger than the argument the curriculum expected, because the reason isn't that retrieval is unnecessary — it's that **retrieval was never where the accuracy was.**

---

## The measurement

```
accuracy         20/21   worst of three runs
invention rate   0/15    across all three runs
bad citations    0–1
cost             $0.0086 per question  (~7.2k input tokens)
```

Whole corpus in the prompt. `claude-haiku-4-5`. No chunking, no embeddings, no index.

The arithmetic that made the decision before any opinion did:

| | |
|---|---|
| Narrative corpus | ~4,200 words ≈ 6,000 tokens |
| Context window | 200,000 |
| Share of one request | **3%** |
| Cost at ~5 questions/day | **~$16/year** |
| What retrieval would save | **~$13/year** |

---

## Four defects, found by typing at it

The eval was passing 20/20, three runs running, when a person sat down and asked it eight questions. None of the four things they found was a retrieval problem.

### 1. A stale document beat the authoritative data — on a booking rule

```
booking-rules.yaml   (authoritative)  every Saturday 08:30–11:00
competition-rules.md (stale, 2023)    first and third Saturdays only
```

The agent used the document. A member was told the 2nd and 4th Saturdays were bookable; they are closed. **A booking error, on the highest-blast-radius job in the PRD.**

> **Specificity beat authority.** "First and third Saturdays" is detailed and confident. "saturday" is terse. The model trusted the one that sounded better informed — and detail is exactly what goes stale first.

Fixed at the corpus, not the prompt. The rule that decided it: *eliminate conflicts where the blast radius is high; keep them where you want to test judgement.* A wrong guest fee is a conversation. A wrong booking rule is a member driving to a closed tee sheet.

### 2. YAML comments are invisible to the model

```yaml
competition:
  # Tee sheet closed to general booking during these windows
  - day: saturday
```

The parser drops comments. The model saw `{"day":"saturday","from":"08:30","to":"11:00"}` and could not tell whether that was when competitions *happen* or when booking is *shut*.

Systemic — `fees.yaml` explained "per guest, per round" and the rise from $15 in comments too. Both invisible.

> Documentation written for a human reading the file is not read by the model, which reads the **parsed** file.

Meaning now lives in the data as a `meaning:` key. This is the finding most likely to be true of somebody else's project too.

### 3. The abstention branch was an uncited escape hatch

Citations are required on answers. Nothing was required on `suggestion` — so a decline could still deliver unsourced facts through the branch designed to be safe. Now routing only, with a `contact` enum.

### 4. Staleness never reached the member

The prompt asked the model to mention an overdue source. It answered from a 2023 document and said nothing. Moved to code.

> **Asking a model to remember something is a request. Computing it is a guarantee.**

**Three of the four were data modelling. One was enforcement placement. None was retrieval.**

---

## Seven assertion errors in one day

The eval was wrong about the agent seven times:

| | The assertion | Why it was wrong |
|---|---|---|
| 1 | `expectAbsent: ["15"]` on the guest fee | Failed the *best* answer as well as the worst |
| 2 | Bar hours must cite the document | `hours.yaml` is authoritative; citing it is better |
| 3 | Live bookings must cite the YAML | The FAQ legitimately restates the rule |
| 4 | Denim question asked "in the spike bar" | Too specific — the conflict only surfaces unqualified |
| 5 | Denim answer must say "bar manager" | Jurisdictions partition cleanly; nothing to decide |
| 6–7 | Pace of play must contain one of *n* phrasings | Widened to seven variants, still missed "three hours **and** fifteen minutes" |

> **You cannot enumerate the ways a sentence can be phrased.**

So the harness now splits assertions the way day 7 split judging: **source, abstention, citation-verification and forbidden-value gate; content phrasing reports.** Gating on a fuzzy signal is how a suite gets switched off.

Worth noticing which side the errors are on. The agent was wrong about the corpus a handful of times; the *tests* were wrong about the agent seven times. Knowledge evals are markedly harder to assert than behaviour evals, because "correct" depends on how the question was asked.

---

## Two API realities

**Structured outputs refuse discriminated unions.** `400 output_config.format.schema: For 'anyOf', '$defs' is not supported`. The plan was `.min(1)` on the answered branch making an uncited answer structurally impossible. Not available — so the guarantee moved **down a layer**: flat schema the API accepts, plus code rejecting an "answered" with no citations. Still structural, one step later.

**Verbatim quoting is the wrong check for structured data.** Nobody quotes a YAML file. The model reads the JSON and writes "Friday to Sunday, closes 23:00" — a faithful citation that fails an exact-substring test. Now verifies that the *values* appear, not the formatting.

And the verifier was wrong before the model was: the prompt sent `JSON.stringify(x, null, 2)` while the check compared against `JSON.stringify(x)`. Every YAML citation was flagged as invented. Same lesson as the day-7 judge — **a detector that reports failures it cannot substantiate is worse than no detector.**

---

## Reflection

**1. Two accuracy numbers? Did retrieval beat stuffing? Where does it flip?**

**There is only one number**, and the note says so rather than implying a comparison that did not happen: **20/21 for stuffing.** FTS5 was not built, because trigger 1 is not close (6k tokens against a 40k threshold) and trigger 3 is thirteen dollars a year.

The prediction, recorded so it can be checked: retrieval should make accuracy **fall**, concentrated on questions needing two documents at once. *"Can I wear jeans?"* requires the ban **and** the spike-bar exception in one answer; top-5 retrieval returning one produces a confident half-truth. Cost should fall ~6×.

The flip point is **~40k tokens of narrative** — 20% of the window, leaving room for the conversation. Below that, stuffing has perfect recall by construction and retrieval can only lose some.

**2. What fraction was answerable from structured data alone?**

Of the sixteen answerable questions, **nine — 56% — need no retrieval at all.** They are tool calls with exactly one right value. (Counted rather than estimated: I first wrote "eight, half", and was wrong by one.)

What that suggests about where to invest is the day's whole argument: **data modelling, not retrieval technique.** More than half the questions were removed from the retrieval problem entirely by sorting facts into YAML, and that took an hour. No amount of embedding tuning would have made those nine answers more correct, because they are now exact.

**3. The corpus contains contradictions. What did the agent do?**

Four of them, and it got three right:

| Conflict | What it did | Right? |
|---|---|---|
| Guest fee: $15 in prose, $20 in YAML | Used the YAML | ✅ |
| Denim: banned everywhere / permitted in the spike bar | Surfaced both, cited both | ✅ |
| Closing time: bar 23:00 / FAQ 22:30 | Used the authoritative source | ✅ |
| **Saturday window: YAML vs stale document** | **Used the stale document** | ❌ |

The one it got wrong was the highest-stakes one.

What it *should* do depends on the kind of conflict, and the distinction is worth keeping:

- **Stale value vs authoritative value** → use the authoritative one; mention the discrepancy if it affects the member.
- **Two owners, clean partition** (denim: everywhere vs the spike bar) → surface both, say which applies where. Naming a decision-maker is ceremony; there is nothing to decide.
- **Two owners, genuine overlap** → surface both *and* name who decides. The corpus does not currently contain one of these, which is why assertion #5 was demanding something the situation never required.

**4. How would a member notice a stale answer before you do? What does it cost?**

**By acting on it.** They arrive on the second Saturday of the month expecting to play, and the sheet is closed. They budget $15 for a guest and get charged $20.

Which means the club learns through **complaints** — a slow, lossy channel that only surfaces the members annoyed enough to say something, long after the answer was given.

It is the same shape as the day-8 confirmation-email finding: the member discovers the error at the worst possible moment, at the club, in front of other people. The cost is not the wrong fact; it is that the correction happens in public and the trust does not come back.

Hence review dates on every document and a staleness warning appended by code rather than remembered by the model.

**5. A supplier proposes a vector database. Three questions.**

1. **"What is our corpus size in tokens, and what accuracy do we get today without you?"** If they cannot answer both, they are not proposing a solution to a measured problem. Ours is 6,000 tokens at 95%+.

2. **"Which of our four measured failures would this have prevented?"** The answer is none — three were data modelling and one was enforcement placement. This question moves the conversation from capability to evidence, and it is very hard to answer with a slide.

3. **"What happens when a document changes?"** The index has to be rebuilt, and the gap between the document changing and the index catching up is a window in which the agent confidently cites something that no longer exists. That is an *ongoing* cost nobody quotes, and it is the one that eventually bites.

A fourth, if the room allows it: **"What does this cost us in recall?"** Stuffing has perfect recall by construction. Every retrieval scheme is a bet that the top-k contains the answer, and that bet is sometimes lost silently.

---

## What day 9 changed about the project

Day 8 put *"what does my membership include?"* below the v1 line because it was unverifiable.

It turns out **half of that job is a tool call** — the guest allowances, the fees, the booking windows — with exactly one right answer, fully checkable. What remains genuinely unverifiable is a much smaller thing: dress-code judgement, etiquette, the edge cases where "smart" is doing the work.

That is a candidate for promotion above the line, on a narrower scope than the original job. Which is what the PRD said would happen: *"revisit after v1, with citation-to-handbook and a measured accuracy bar."* Both now exist.
