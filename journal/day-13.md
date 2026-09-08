# Day 13 — Observability

**Project:** 03-golf-club-agent · **Deliverable:** trace schema, tracer, full instrumentation, viewer, PII redaction, four metric families, six alerts, runbook

The day that turns the thing you have been debugging with all month into something that survives the terminal being closed.

---

## Why an agent is harder than a service

A conventional service takes the same path for the same input, so a bug can be reproduced. An agent's reasoning varies run to run — when a member says *"your bot told me the wrong green fee"*, **you cannot re-run it and see.**

There is direct evidence for that in this project. Thirteen defects this month were found by a person reading `→ tool(args)` lines in a terminal, and **every one of those traces was ephemeral.** It scrolled away.

Twice this week a trace was found to be *lying*: once it logged the model's requested arguments as though they were the outcome, and once a handoff reported a refused booking as `✓ Booked` because it inferred success by matching prose.

> **A trace that misreports what happened is worse than no trace.** It is confidently wrong in the one artefact you consult when something has gone wrong.

---

## Versions are computed, not declared

Every YAML here carries a hand-maintained `last_updated` — a claim somebody has to remember to make true. Model, prompt, policy and corpus are now **content hashes**, stamped on every span.

Policy and corpus hash separately, because they fail differently and are changed by different people. One combined hash would only say *"something in the data moved"*.

This matters more for agents than services: **"nothing was deployed" is almost never true.** The model changes underneath you, the corpus changes, the supplier changes, and none of it touches the repository.

---

## Two audiences, and the club's answer found it

Asked what the pro shop should be alerted about, the answer was: a booking clash, the morning schedule, the secretary changing something, a delivery, a VIP arriving.

**Four of five have nothing to do with the agent.** That is the finding, not a misread question.

The PRD makes the Pro Shop Manager accountable for agent behaviour — and handed *"validation failure rate exceeded 1% for 15 minutes"* they can do nothing, because they are one person running a shop.

```
Pro shop manager   operational, in club language, ends in a phone call
Agent owner        leading indicators, in system language
```

Every alert now names its audience. **An alert nobody can action is noise, and noise trains people to ignore alerts** — including the one that mattered.

And the highest-value item on the club's list was **not an alert at all**. The morning schedule is a *digest*, read with a coffee, and it would actually get read. **Alerts interrupt; digests inform.**

---

## The debugging exercise

A bug was planted without telling me what it was: `fees.yaml` quietly dropped from what the knowledge agent is given, everything else intact. Every member asking about a fee got *"I don't have anything on that."*

**Found from data alone in about 20 minutes**, no code read until the diagnosis was made:

```
npm run metrics    abstention 22.2% — wrong for the traffic, not obviously broken
npm run trace      narrowed to two conversations
  segmentation     FAILED — every knowledge call was affected, no good one to compare
trace … full       the context window: the fact was never in front of the model
grep late_fee      0
```

The honest breakdown of those twenty minutes is roughly **five minutes of investigation and fifteen minutes blocked on instrumentation.** The fifteen is the more useful number.

### Not one of four suites caught it

| Suite | Checks | Why it missed |
|---|---|---|
| Unit tests | 109 | Never call `ask()` |
| Reliability | 19 | No model in the loop |
| Conversational | 17 | Assert on tool calls, not answer content |
| **Knowledge eval** | 21 | **Scored 21/21** — calls `ask()` directly |

```
knowledge-eval.ts:44   ask(q.question, docs, structured)       ← the eval's path
agent.ts:1431          ask(question, docs, knowledgeInput())   ← the agent's path
```

The eval tests `ask()`. The agent uses a different call site. Two things each correct in isolation and **a seam nobody tested across** — the same shape as *"the booking path had never read the club's rulebook"*, and the exact warning in this repo's own testing standard:

> **A test that goes through a different code path than production is testing a different program.**

Covered now by a conversational case that asks a fee question through the agent's own path, **proven red with the bug still in place** before the bug was removed.

### Four tooling defects, all found by using it

| | |
|---|---|
| The listing said a conversation happened, not what it was | finding two abstentions meant opening all ten |
| The knowledge call's context window was not recorded | done for the routing model, not for the model that answers |
| `span()`'s `meta` could override `input` and the tracer **ignored it** | the fix recorded `system: ""` and *looked* like it had worked |
| No way to filter | twenty conversations is forty lines |

The third is the nastiest. **The field was present, populated and wrong** — not missing. Had the raw payload not been dumped, the conclusion would have been "the corpus is empty" and the hunt would have moved to `loadStructured`.

**A trace viewer you have never debugged with is a trace viewer with four holes in it.**

### Two method lessons

**Segmentation can fail.** Step 4 of every debugging method is "compare a good one with a bad one" — and when *every* call is affected there is no good one. The answer has to come from reading what was actually sent.

**Grep for the value, not the container.** Searching the prompt for `fees.yaml` found one hit — a cross-reference inside another file's prose. Searching for `late_fee` found none, which was the answer. A filename tells you somebody mentioned a file; a field name tells you the data arrived.

---

## Reflection

**1. How long, and what data did you wish you had?**

Twenty minutes, of which fifteen were blocked on missing instrumentation. Everything wished for was added during the hunt, which the exercise explicitly asks for: the question on the listing, `--abstained` and word filters, and the knowledge call's full context window.

What is still missing: **a way to compare two traces directly.** Every step of the method that failed, failed for want of a diff — and doing it by eye across two `full` dumps is the reason segmentation was abandoned rather than done badly.

**2. Which leading indicator would have caught it earliest?**

**Abstention rate**, and it did — but only because I knew what nine questions had been asked. At 22.2% on nine questions it is two, and one of those two was *supposed* to abstain. On a real day's traffic that signal would have been much weaker.

The genuinely earliest indicator would have been **abstention rate by topic**, which does not exist. "Every question about fees declines and nothing else does" is a far louder signal than a single blended percentage, and it is the metric this exercise says to build.

**3. Cost per resolution, and is the business case real?**

**$0.0126 per conversation**, and with no escalations in that sample, $0.0126 per resolution.

Against the PRD's baseline of ~4 minutes of staff time per interaction, at a plausible ~$30/hour that is about **$2.00 of staff time versus a little over one cent.** Roughly 160×.

But the honest reading is that **the cost comparison is not the business case.** At ~7,300 interactions a year the agent saves perhaps $14,000 of notional staff time — and the club is not going to make anybody redundant. What was actually asked for was *"70–80% of my time back during the day, and bookings taken out of hours"*, and neither of those shows up in cost per resolution.

The number is worth having because a CFO will ask for it. It is not worth leading with.

**4. A complaint about a conversation three weeks ago. Can you answer it?**

Today, yes — the trace store keeps everything and nothing prunes it.

That is not a policy, it is an absence of one. The design document says **30 days full, then aggregates**, and *nothing enforces it* — the same gap day 11 recorded for memory, in a store that now holds every word a member has said.

There is no conflict between retention and investigation at 30 days; a complaint older than that is rare and can be answered from the queue and the tee sheet. **The conflict is between the policy being written down and it being true.**

**5. Which alert would fire most often, and is it noise?**

`bad_citations`, which fires on any count above zero.

And it would be **noise**, on this project's own evidence: that detector has produced **four false positives** and zero true ones — a `JSON.stringify` mismatch, a demand for a digit that rejected `"AUD"`, a quoted token against a folded YAML block, and a filename cross-reference. Every one was the detector, not the model.

An alert whose historical precision is 0/4 trains people to ignore it, which is the failure the runbook rule exists to prevent. It should be **downgraded to the digest** until it has caught something real, and the honest version of that is a threshold above zero rather than a critical page on one occurrence.

---

## What day 13 was actually about

The infrastructure took an afternoon. **The exercise found more than the infrastructure did** — four holes in the viewer and a seam across four test suites, none of which any test could have told me about, because the only way to find out whether a debugging tool works is to debug with it.

> The bug was in the agent for twenty minutes. The tooling had been broken since the moment it was written.
