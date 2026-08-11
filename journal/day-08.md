# Day 8 — Product Requirements and Jobs-to-be-Done

**Project:** 03-golf-club-agent · **Deliverable:** `PRD.md`, 13 sections

The first day with no code. Also the first day the answer came out as *"probably don't build this yet"*, which turned out to be the useful part.

---

## What the document actually says

Thirteen sections: problem, jobs, four capability specs, twenty anti-requirements, integration inventory, escalation design, seven metrics, rollout, risks, governance, out of scope, open questions — and a thirteenth arguing the project should not be approved.

**Its own recommendation is not "build the agent."** It is: buy online booking first, measure whether out-of-hours demand is real, then decide whether the remaining jobs justify an agent.

---

## Three findings that came from answers, not from a template

### 1. One sentence produced an architectural rule

Asked how booking errors surface today:

> *"Wrong time or date gets booked. Confirmation email goes out. Sometimes the customer catches it then. Sometimes when they show up."*

That is not a description of a problem. It is the club's **existing error-detection loop**, and it forces a design decision:

**The confirmation email must be generated from the tee-sheet record, never from the agent's message.**

An agent's characteristic failure is say/do divergence — telling the member "Saturday 9am" while writing Sunday. An agent-composed confirmation faithfully repeats "Saturday", the member is satisfied, and the error becomes invisible until they arrive. **It converts every recoverable error into an unrecoverable one.**

Same error rate. Completely different business. Cost of the decision: choosing which string goes in an email, once, in a document, before any code exists.

### 2. "No agent taking money" collided with the club's own rules

Scope decision, made early and clearly: the agent handles no money.

Then the club's rules arrived: guests cost **$20**, late cancellation costs **$15**. Both sit inside v1 jobs.

So the agent takes no payment — but it can commit a member to owing money. Which is arguably worse, because it has none of the friction of a payment flow:

> No card, no total, no checkout screen. A member says "yeah bring Dave and Steve" and is $40 down.

And it surfaces on a statement six weeks later — the same "discovered days later" failure identified in finding 1.

Refined:

| | |
|---|---|
| **Process a payment** | Never. Out of scope. |
| **Incur a charge** | Only after stating the exact amount and receiving explicit confirmation *of that amount*. |

### 3. "A Google Sheet" made the biggest risk a spreadsheet

Asked what the club uses for the tee sheet. A Google Sheet, membership on another tab.

The curriculum's warning — *"the hardest problems are integration and data quality, not AI"* — stopped being abstract:

| Missing | Consequence |
|---|---|
| Idempotency | A retried write creates a **second booking** |
| Transactions | Booking and guest-allowance decrement cannot both succeed or both fail |
| Row locking | Two members book the same slot, both read "available" |
| **Exclusive writers** | **Staff edit the sheet all day.** Every agent read is stale on arrival |

The last one cannot be engineered away. The agent is not the only writer and never will be, so any check-then-write races a human being.

**Consequence: the agent must not write to the tee sheet.** It appends to a request log; one worker applies requests in order. Appending is the one thing a spreadsheet does safely, because it requires no read.

The cost — a booking is *requested* instantly and *confirmed* in seconds — is a product decision, and belongs in the PRD rather than being discovered by a developer at 4pm.

---

## The arithmetic that changed a metric

The manager wanted *"70–80% of my time back."*

```
20 interactions × 4 min  =  80 min/day
Staffed day              = 510 min
                         = ~16%
```

**A perfect agent handling every interaction returns ~16% of the day.** Writing 70% into the PRD would have failed the project against its own criteria however well it worked.

But the manager was not wrong — they were describing the wrong quantity. 20 interactions across 510 minutes is **one every 25 minutes**. The cost is fragmentation, not duration: no block of the day is long enough to do the stock order in.

So the metrics became **interruption count** and **longest uninterrupted block**, not time saved. Going from 20 interruptions to 6 saves barely an hour and turns a fragmented day into three clear ones.

That is what a PRD is for. A number that felt right, checked against 20 × 4 minutes, became a target that can be hit and a benefit the manager will actually feel.

---

## The objection the document could not beat

Exercise 9 asks you to argue against your own project. Three objections; two answerable.

> A tee-sheet system with online booking costs ~£1,500/year, has an API and idempotency, and solves out-of-hours booking **completely** — no accuracy risk, no DPIA, no eval harness, no weekly human review.
>
> The primary stated benefit is "take bookings out of hours". A form does that at 100%. An agent does it at 99%.

**Nothing in sections 1–12 established that conversation was necessary. It had been assumed.**

The response is a change of plan rather than a rebuttal — buy the form, measure the demand, then decide. The agent's justification narrows from *volume* to *the jobs a form cannot do*: ambiguous multi-constraint requests, guest allowances, complaints, and a membership that skews older and may not use a portal.

Smaller claim. More defensible.

---

## Reflection

**1. Highest value, lowest checkability — and the tension.**

Among v1 jobs, **reporting a course problem**. It is frequent, emotionally loaded, and the half that matters — did the member feel heard — has no fact anywhere that settles it.

Handled by **splitting the job**: the routing half is checkable (a record exists, with their words, sent to greenkeeping) and asserted like anything else; the acknowledgement half is not, and gets sampled human review, 20 conversations a week, forever.

The tension does not resolve. It gets a budget. An hour a week of a manager's time is the price of the one job that could quietly lose a member — and the metric with a person in it is the only instrument that measures it.

**2. The most dangerous action.**

**Cancelling a tee time.** Intuition says booking; intuition is wrong. A wrong booking is undone for free. A cancelled slot returns to the pool and is gone within minutes — and now costs the member $15.

Before shipping it:

- The specific booking named back to the member, never inferred when two exist
- The fee **computed by code** from the timestamp, never stated by the model
- Explicit confirmation carrying the number
- Zero wrong cancellations across the 50-conversation internal stage

**3. The containment incentive — and a hole this question found.**

> An agent that resolves 100% of conversations by refusing everything and never escalating has perfect containment.

§7 pairs containment with **escalation appropriateness**: of the escalations that happened, how many genuinely needed a person.

**Answering this question properly exposed that the pairing only works in one direction.** It catches *over*-escalation — handing off things it could have handled. It does not catch *under*-escalation, which is the gameable direction: an agent that contains a conversation it should have passed on scores well on both metrics.

Catching that needs sampled review of **contained** conversations, not escalated ones. That is not currently in §7 and should be. Recorded as a gap rather than quietly fixed, because the question found it and the document should show its working.

**4. "Can it just do everything the receptionist does?"**

> She does about fifteen different things, and it can do seven of them well — the ones where there's a right answer we can check afterwards. The other eight are things like advising on equipment or judging whether the greens really are poor, where there's no way to tell whether it got it right, so we'd never know when it was wrong. I'd rather it did seven things you can trust than fifteen you have to check behind.

**5. Where this differs most from a conventional software PRD.**

| | Conventional | Agent |
|---|---|---|
| Accuracy | A bug, fixed once | A **rate**, specified as a requirement |
| Failure modes | The QA plan | The **specification** |
| "What if it can't?" | Error handling | **Product** — a first-class job with an SLA |
| Constraints | Implied by requirements | An explicit anti-requirements section, and **the most-read part of the document** |
| Enforcement | Not a PRD concern | Named per rule — because a rule in a prompt is a request and a rule in code is a guarantee |

The last row is the one week 1 bought. Twenty "must nevers" without saying which are enforced and which are hoped for has promised twenty guarantees and can deliver sixteen.

---

## What was different about this day

No code, and the balance of work changed with it. Week 1 drifted into too much being written for me; here the decisions were mine — the v1 line, the money refinement, promoting complaints above the line, the Google Sheet — and the drafting followed them.

The three findings above all came from answers to four plain questions about how the club works today. None came from thinking about models.
