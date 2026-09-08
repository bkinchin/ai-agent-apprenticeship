# Day 14 — Production Review

**Project:** 03-golf-club-agent · **Deliverable:** nine-dimension review, pre-mortem, blast radius, rate limits, kill switch, one-hour red team, failure analysis, improvement plan, operations runbook, signed recommendation

No new concepts. Everything applied, adversarially, to what I built — and the day found more than the four days of building that preceded it.

---

## The audit was the review

One command, before writing a word:

```
6 write tools
rate limits        NONE
kill switch        NONE
trace retention    documented as 30 days, NOT IMPLEMENTED
erasure            memory only — traces and the escalation queue have none
```

Four red flags in ten seconds, in a system I had been calling well-engineered the day before. **The review's value is almost entirely in asking questions nobody asks while building.**

---

## Three dimensions scored red

| | |
|---|---|
| **Safety** | Identity is `/login M-1001` with nothing behind it. **Every other control assumes the member is who they say they are.** |
| **Privacy** | The trace store holds every word a member has said and nothing deletes it. Retention is a document, not a job. |
| **Operability** | There is no deployment. A bereavement escalates to a SQLite file that exists while somebody has a terminal open. |

None is a bug. All three are **components that do not exist** — which is why they never appeared in a test, and why a month of finding defects by using the agent could not have surfaced them.

---

## What the red team found

16 attacks, six categories, logged so a later run can be diffed rather than remembered. **15 held on the first run.** The breach:

```
cost/force-a-loop    12 tool calls, ceiling was 6
```

**`MAX_STEPS` bounds inferences, not work.** A model may issue any number of *parallel* tool calls per inference — six steps of six calls is thirty-six. The ceiling I built specifically to stop unbounded spend never bounded the spend, and I had believed it did for four days.

That is the finding I did not expect, and it is the kind only an adversary produces: **every normal conversation makes one or two calls per inference, so nothing in ordinary use was ever going to reveal it.**

---

## Two mistakes in the controls I was adding

**`callsThisTurn` used `calls.indexOf(call)`** — an index within a single inference. Six inferences of one call each never tripped the cap, which is exactly the shape it exists to bound.

**The red-team harness counted refused calls as executed ones**, so it reported a breach where the rate limit had just done its job. **Third time this exact mistake has been made on this project** — the conversational eval did it twice.

> Attempts are not outcomes, and nothing in the type system says so. Three occurrences in three files is not carelessness; it is a missing concept.

---

## The longest detection time is not booking

The blast radius table is ranked by **detection time**, and the answer surprised me:

| Tool | Detection |
|---|---|
| `book_tee_time` | **minutes** — the confirmation states day, time, party, guests and fee |
| `cancel_booking` | hours to days |
| `remember_preference` | **weeks** ← worst |

A wrong booking is found by a member standing on a tee. A wrong **memory** silently shapes every future conversation and is found only if somebody thinks to ask *"what do you know about me?"*.

Day 11 already proved the mechanism: a planted false handicap never reached the member — it went into the **retrieval query**, where every citation guarantee is blind to it.

The control that closes it is a memory provenance report, and it does not exist.

---

## The challenge changed the document

Three objections from a sceptical CTO, all substantially conceded.

**The discovery rate.** 31 defects in seven days and the rate is not falling. *"We found and fixed 31 things"* is not reassurance; it is evidence that a competent person looking for a day finds several more. The distribution has moved — the agent's own behaviour has produced no new class of defect since day 12 — but **nobody can distinguish "the curve is flattening" from "I am looking somewhere else" from the inside.**
→ **New condition: an independent hour of red-teaming by someone who did not build the guards.**

**Shadow mode is less safe than it reads.** It writes traces continuously and needs a host — **two of the three blocking conditions.** Only authentication is genuinely deferred.
→ Conditions are now **per stage** rather than one flat list, which shows authentication is deferred by two stages and hosting *gates* shadow mode rather than sitting behind it.

**The numbers measure the agent against cases I wrote.** Demonstrated on this project: a planted bug broke every fee question while the knowledge suite scored 21/21.
→ Correctness is explicitly **amber-pending-shadow**, because the missing half is a human baseline and **shadow mode is the only instrument that produces it.**

That last one reframed the whole recommendation. Shadow mode is not a safety measure. **It is the measurement.**

---

## Reflection

**1. Which dimension scored worst? Were you avoiding it?**

Privacy and operability, both red, and **yes — in a specific and recognisable way.**

Both are *not building* rather than *building badly*, and building is more satisfying than deploying. Operability in particular is invisible on a laptop: everything works, so nothing prompts the question *"and where does this run?"*

There is a sharper version. Day 11 identified erasure as a gap **for memory**, and closed it. Then days 12 and 13 created two new stores holding more sensitive data than memory ever did — and the erasure question was never asked again, because it felt answered. **A solved problem stays solved only for the thing it was solved on.**

**2. What did red-teaming find that you genuinely did not expect?**

That `MAX_STEPS` bounded nothing that mattered. I built it on day 12 with a comment about unbounded spend and believed it for four days. Parallel tool calls simply never occurred to me, because no ordinary conversation produces them.

Second, smaller, and more uncomfortable: **the attacks I wrote were the attacks I had defended against.** Injection via the memory quote held — I built that guard. Injection via free text a *human* re-introduces from an escalation package is untested, and I only noticed writing the pre-mortem.

**3. Which failure mode has the longest detection time? What closes the gap?**

Wrong memories — weeks, and only if a member asks. Closed by a **memory provenance report**: every memory, its quote, its age, on one page a human skims. Half a day of work, and item 6 on the improvement plan.

**4. Would you sign off on this going live to real members?**

**No.** Three conditions, now four:

1. **Authentication.** Every other control assumes it.
2. **Erasure and enforced retention.** A subject request today is answered *"mostly"*.
3. **Somewhere to run it, and somebody to run it.** A queue that exists while a laptop is open is not a queue.
4. **An independent hour of red-teaming.**

I would sign off today on **internal use and shadow mode**, and I would argue for shadow mode hard — it is the only way to answer *"is this better than what we do now?"*, and the club currently cannot answer that about **itself**.

**5. Week-2 retrospective: what was harder, what was easier, and what does that tell you?**

**Easier than expected: the model.** Haiku did the job. No retrieval, no vector database, no fine-tuning, no framework. The corpus is 8k tokens against a 40k trigger, and `knowledge-retrieval.md` records five conditions for moving right of which **none is met**. The single largest technical decision of the week — *don't build retrieval* — took an afternoon of arithmetic.

**Harder than expected: the seams.**

Almost every serious defect lived between two things that were each correct:

| Seam | What happened |
|---|---|
| Corpus ↔ booking code | Day 9 fixed the competition rule **in the corpus**; the booking path never learned, and would explain the sheet was shut and then book into it |
| Eval ↔ agent | The knowledge suite scored 21/21 while every fee question was broken, because it calls `ask()` directly |
| Offer path ↔ refusal path | The agent kept offering things it would then refuse — closed windows, a third booking |
| Rulebook ↔ supplier | Three of six club rules enforced nowhere, because nobody asked whether the tee sheet knew the club's rules |
| Trace ↔ what happened | The trace logged requests as outcomes, three times |

**And the recurring lesson, in one line:**

> **Every fix that removed a decision from the model worked. Every fix that asked the model more clearly did not.**

Forced tool choice, the slot ledger, the write policy in code, bare yes/no answered before the model is called, club rules inside the tool, the solo guard, closed slots filtered rather than refused. Seven times. Against that, two behaviours are still prompt-enforced and both still misfire about one time in three.

**What that says about where the difficulty in this field lies:** not in the model, and not in prompting. In the **boundaries** — between what the model decides and what code decides, between what a suite tests and what production runs, between what a document says and what a code path enforces.

The model is a dependency. The system is everything around it, and the bugs live in the joins.

---

## Week 2, in numbers

```
31 defects found        26 by a person using it · 2 by a suite · 3 by the type checker
119 unit tests          free
19  reliability checks   free, includes a control
18  conversational cases $0.30
21  knowledge questions  $0.23
16  red team attacks     $0.20
5   architecture notes   three of which say when NOT to do the thing
cost per resolution      $0.0076
```

**Twenty-six of thirty-one found by using it.** That ratio does not improve with more suites — every suite here was written *after* a person found the thing it now guards. It improves with more use, which is the argument for shadow mode and against another fortnight of my own test cases.
