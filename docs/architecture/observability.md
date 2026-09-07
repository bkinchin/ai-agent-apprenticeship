# Observability

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 13

How to reconstruct what the agent did and why, from data alone.

---

## Why an agent is harder than a service

A conventional service has deterministic logic: the same input takes the same path, so a bug can be reproduced by re-running it. An agent has a reasoning trace that varies run to run.

When a member says *"your bot told me the wrong green fee"*, **you cannot re-run it and see.** The original run has to have been recorded in enough detail to answer the question afterwards. Anything else is debugging by re-prompting and hoping.

This project has evidence for that. Thirteen defects were found this month by a person reading the `→ tool(args)` lines in a terminal — and every one of those traces was **ephemeral**. It scrolled away. Twice this week a trace was found to be *lying*: once it logged the model's requested arguments as though they were the outcome, and once a handoff package reported a refused booking as `✓ Booked` because it inferred success by matching prose.

> **A trace that misreports what happened is worse than no trace.** It is confidently wrong in the one artefact you consult when something has gone wrong.

---

## The trace schema

One conversation is one trace. Spans nest inside it.

| Field | Why |
|---|---|
| `traceId` `spanId` `parentId` | the tree |
| `sessionId` `subject` | which conversation, whose — **pseudonymised** |
| `type` `name` | `turn` · `llm` · `tool` · `knowledge` · `memory` · `policy` · `escalation` |
| `startedAt` `durationMs` | timing, and p95 later |
| `input` `output` | **the actual content**, never a summary |
| `tokensIn` `tokensOut` `costAud` | cost attribution |
| `versions` | model · prompt · policy · corpus |
| `outcome` | `ok` · `error` · `denied` |

### Versions are computed, not declared

```
model    the pinned id
prompt   sha256 of the system prompt template
policy   sha256 of escalation.yaml + booking-rules.yaml + fees.yaml
corpus   sha256 of every document and structured file
```

Every YAML here carries a hand-maintained `last_updated`. **A version you type is a version that drifts; a version you compute is a fact.** When quality drops on a Tuesday, *"the corpus hash changed on Monday"* is evidence. *"Someone updated the front matter"* is not.

This matters more for agents than for services, because **"nothing was deployed" is almost never true**: the model changes underneath you, the corpus changes, the supplier changes, and none of those touch your repository.

### The full context window is stored

The largest field, and the one people drop to save space and then need. At ~7k tokens per knowledge call this is roughly 30KB per conversation — **about a megabyte a month at twenty interactions a day.**

Storage is not the constraint. Retention and privacy are, and those are a different problem with a different answer.

---

## Emission is async and cannot fail the request

> **Observability that can break the request is worse than none.**

Spans are buffered and written on a timer. Every emission path is wrapped so a failure is swallowed and counted, never thrown. A trace store that is full, locked or missing must degrade to *no traces*, not to *no agent*.

Context propagates through `AsyncLocalStorage` — Node's built-in ambient context that follows the async call chain — so a function three layers down can add a span without a tracer argument threaded through everything above it. Without that, instrumentation becomes the thing nobody is willing to add.

---

## Leading and lagging

| | |
|---|---|
| **Lagging** | complaints, task success falling, containment dropping — *you already have a problem* |
| **Leading** | validation failures rising, steps per conversation creeping, one tool's error rate, escalation reason mix shifting, cost per conversation rising on flat volume — *you have hours or days* |

> **Alert on the leading indicators. Report on the lagging ones.** A team that only watches task success finds out from customers.

---

## Two audiences, two languages

The PRD makes the **Pro Shop Manager** accountable for agent behaviour. Handed *"schema validation failure rate exceeded 1% for 15 minutes"*, they can do nothing with it — they are one person running a shop.

Asked what they would want to be alerted about, the club's answer was: a booking clash, the morning's schedule, the secretary changing something, a delivery, a VIP arriving. **Four of five have nothing to do with the agent at all.**

That is the finding, not a misunderstanding of the question:

```
Pro shop manager   operational, in club language, actionable in the shop
                   "Two members are booked into 09:20 on Saturday."

Agent owner        leading indicators, in system language
                   "Cost per conversation doubled on flat volume."
```

**An alert nobody knows how to action is noise, and noise trains people to ignore alerts.** So every alert names its audience and carries a runbook entry, and anything the manager cannot act on goes to the agent owner instead.

### Alerts interrupt. Digests inform.

The morning schedule email was the highest-value item on the club's list and it is **not an alert** — it is a digest, read with a coffee, and it would actually get read. Conflating the two is how people end up ignoring both.

### The booking clash is the join

It is the only item that is both: technically the day-10 race, operationally a phone call before someone drives in. It is also the one where **the agent may be the cause**, so it carries the trace — *"here is the conversation that did it."*

That link is what a trace store makes possible and a metrics dashboard does not.

---

## PII

Traces contain everything a member said, which is personal data, and this is where privacy programmes usually fail.

- **Redact on write, not on read.** Emails, phones, card numbers masked at ingestion — if it is only masked at display, it is still in the database.
- **Pseudonymise the subject.** A stable hash, with the mapping held separately.
- **Retention enforced, not documented.** 30 days full, then aggregates.
- **Erasure requests must reach the trace store.** Day 11 recorded that memory erasure was solved and traces were not, because traces did not exist yet. They do now.

---

## Cost per resolution

Cost per conversation divided by the resolution rate. An agent at $0.03 a conversation resolving 40% costs **$0.075 per resolution** — and that is the number to compare against a member of staff doing the same job.

It is the single figure a CFO asks for and most teams cannot produce, because it needs cost and outcome recorded against the same conversation. Which is exactly what a trace is.
