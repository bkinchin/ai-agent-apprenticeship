# Self-Assessment

Score against [SUCCESS_CRITERIA.md](../SUCCESS_CRITERIA.md) on days 7, 14, and 21.

| Score | Meaning |
|---|---|
| 1 | I have heard of it |
| 2 | I can define it |
| 3 | I can explain it with an example |
| 4 | I can explain the tradeoffs and defend a choice |
| 5 | I can design an alternative and say when it would be better |

**Target on day 21: 4+ on every row.**

> **The day-7 column below is a *proposed* score with the evidence beside it — change any of it.** The bar is "you can answer the follow-up question, not just the question", and only you know which follow-ups you'd survive. Where I've suggested a lower score than the work might imply, the reason is written down.

---

## Explain

| # | Capability | Day 7 | Day 14 | Day 21 | Evidence, and the honest caveat |
|---|---|---|---|---|---|
| 1.1 | Agent vs chatbot | 4 | 4 | | Unchanged. Two agents built, and you can now say when a *workflow* would have been better — the golf club's booking flow is a state machine wearing a loop. |
| 1.2 | Why agents need state, and where it lives | 4 | 4 | | Unchanged deliberately. Session state, memory, bookings loaded per session, a trace of every context window. The follow-up you'd still find hard: what happens to any of it at 100 concurrent conversations. |
| 1.3 | How agents use tools; why tool design is the hard part | 4 | **5** | | Raised. `book_tee_time` is one tool over four calls; `amend_booking` exists because the model built a saga out of two irreversible steps and got it wrong. You can design a different tool boundary and say what it costs — terminal tools buy verifiability and cost fluency. |
| 1.4 | Structured output and enforcement | 4 | 4 | | Unchanged. The API refusing discriminated unions moved the guarantee down a layer rather than dropping it, which is the tradeoff answer. |
| 1.5 | Workflow vs autonomy tradeoff | 4 | **5** | | Raised. Seven separate fixes that removed a decision from the model, each with a counterweight case proving the guard doesn't over-fire. You can state the rule *and* its cost: the model can no longer recover creatively from a partial failure. |
| 1.6 | Policies, and why prompts are not policies | 4 | **5** | | Raised. The rulebook audit is the evidence — three of six club rules enforced nowhere, and you found it by asking *how could that be forgotten* rather than accepting the one-line fix. |
| 1.7 | Evaluation, and why it's harder than testing | **3** | **4** | | Raised from 3. Three eval layers, the gate/report split, control tests that caught two suites passing for the wrong reason, and the measurement that a probabilistic failure needs repeats. Not 5: you haven't built an engine that works across agents — that's day 18 — and the knowledge suite scored 21/21 while every fee question was broken. |
| 1.8 | Memory vs state, and its risks | 1 | **4** | | From 1. Built it, and the strongest part is what you decided *not* to remember: three of four candidates were lookups, and the fourth turned out to be a database row. Not 5 — end-of-session extraction was deliberately not built, so one of the four write policies is untried. |
| 1.9 | How agents improve from production signal | 2 | **3** | | From 2. The capture exists — every escalation records what the agent was missing, and `console roadmap` sorts it. The loop that turns that into change is day 19. |

## Discuss

| Topic | Day 7 | Day 14 | Day 21 | Evidence |
|---|---|---|---|---|
| Enterprise AI architecture | 4 | 4 | | Unchanged. The seams argument is architectural and evidenced — corpus↔code, eval↔agent, rulebook↔supplier — but it's one system's architecture. |
| Agent reliability | 4 | **5** | | Raised. 31 defects categorised by root cause; blast radius ranked by *detection time* rather than severity; the longest is memory, not booking, and you can say why. |
| Human-in-the-loop systems | 4 | **5** | | Raised. Escalation as a product surface with four trigger sources, assisted mode, reverse handoff — and the two-audiences finding came from your own answer, not the curriculum's. |
| AI governance | **3** | **4** | | From 3. A nine-dimension review with evidence, three reds you didn't flinch from, and a challenge you conceded rather than defended. Still one agent, and still no answer on who reviews a policy change. |
| Business applications of agents | **3** | **4** | | From 3. Cost per resolution measured at $0.0076 — *and* the judgement that it isn't the business case, because the club won't reclaim the staff time. The 'when not to build this' reflex now has evidence behind it. |

---

## Day 14 notes

> **Proposed again — change any of it.** The day-7 rule still applies: the bar is whether you'd survive the follow-up question, and only you know which follow-ups you'd survive.

**Weakest: 1.9 and governance, both for the same reason.** Everything scored highly is about *one* agent, built by you, reviewed by you. Governance of a fleet, and a loop that turns production signal into change, are both week 3.

**The day-7 prediction was tested and half held.** The plan was that week 2 would test whether evaluation judgement transferred to a new domain or was pattern-matching on project 01. It transferred — the gate/report split, control tests and repeats-for-probabilistic-failures all carried over, and control tests caught two suites passing for the wrong reason.

What did *not* transfer was the other resolution: *"too much of week 1's code was written for me rather than by me."* Week 2's code was also written for you. The design decisions were consistently yours — the escalation routing, the memory scope, keeping the agent's offer of a memory mid-conversation, the choice to cover the eval seam with a conversational case rather than rewriting the eval — and the typing was not.

**That matters differently than it did on day 7.** You can defend every architectural decision in this project, and several of them were better than mine. The gap is not comprehension; it is that *"I built this"* is doing less work in an interview than *"I decided this, here is the tradeoff, here is what it cost."* The second is true and is the stronger claim anyway.

**The thing to carry into week 3:** twenty-six of thirty-one defects were found by you using the agent. That ratio held all week and did not improve as the suites grew. Week 3 builds a factory that *generates* agents — and the honest risk is that a generated agent nobody has used is an agent whose defects nobody has found.

---

## Day 7 notes

*Weakest area, and what I'm doing about it in week 2:*

**Weakest: 1.7 — evaluation judgement, not evaluation mechanics.**

The harness is genuinely good. What's a day old is knowing when to believe a number. The evidence for the gap is that all three of these fooled me:

- 63%, 63%, 63% — stable-looking, and a dead judge
- 1-in-6 read as flakiness for an afternoon; it was an unmade decision
- 15/16 and 63% sitting next to each other, same code, because one run is not a rate

That instinct only comes from being fooled, which happened enough this week to stick. Week 2 tests it: the Golf Club Agent is a new domain, so the golden set gets built from scratch and I'll find out whether the discipline transfers or whether it was pattern-matching on this one project.

**Second thing to carry forward: read the transcript.**

13 of 21 defects this week were found by a person reading what the agent actually said. Unit tests found one. The eval found two. Both mechanisms are needed but only one of them *finds* things — and the temptation in week 2 will be to trust a green suite.

**A deliberate change to how week 2 runs.**

Too much of week 1's code was written for me rather than by me. I can explain `parseDateOfBirth` and its failure mode, but I didn't write it — and that gap would show under interview follow-ups. Week 2 opens a new project, which is the natural reset: design discussed first, code written by me, reviewed like a PR.
