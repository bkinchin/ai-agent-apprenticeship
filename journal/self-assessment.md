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
| 1.1 | Agent vs chatbot | 4 | | | `what-is-an-agent.md` holds your v1 and v2 definitions verbatim. The v2 delta — that the loop and the constraints are the agent, not the model — is the tradeoff-level answer. |
| 1.2 | Why agents need state, and where it lives | 4 | | | Session store, SQLite persistence, context assembler, cost-per-turn measured. You found the `slice(-0)` bug by reasoning about what turn *n* receives. |
| 1.3 | How agents use tools; why tool design is the hard part | 4 | | | The day-3 exploit is yours and it's a permanent test case. You can explain why `find_customer` had to go, not just that it did. |
| 1.4 | Structured output and enforcement | 4 | | | Zod at every boundary; you distinguish schema failure from semantic failure and know why you never retry the second. |
| 1.5 | Workflow vs autonomy tradeoff | 4 | | | Four workflow bugs, all ordering, all understood. You specified the rule yourself: *"only the code should change the stage state."* Note the doc named in SUCCESS_CRITERIA (`workflow-vs-autonomy.md`) doesn't exist — largely subsumed by `where-controls-live.md`. |
| 1.6 | Policies, and why prompts are not policies | 4 | | | `where-controls-live.md` ranks six mechanisms with measurements. You pushed back on the YAML ownership question and were right. |
| 1.7 | Evaluation, and why it's harder than testing | **3** | | | The harness is built and the limits are documented. Scored lower deliberately: you can explain it, but the *judgement* about when a measurement is worth trusting is one day old. Three times this week a number looked stable and meant nothing. |
| 1.8 | Memory vs state, and its risks | 1 | | | Day 11. Not covered. |
| 1.9 | How agents improve from production signal | 2 | | | Day 19. You've met the *cost* argument for observability — evals can't reach the rare tail — but not the mechanism. |

## Discuss

| Topic | Day 7 | Day 14 | Day 21 | Evidence |
|---|---|---|---|---|
| Enterprise AI architecture | 4 | | | The security/caching tradeoff is a genuinely architectural argument: capability enforcement and prompt caching are the same lever pulled opposite ways, and you can price it. |
| Agent reliability | 4 | | | 21 defects catalogued and categorised. You can say where bugs actually live (ordering, not prompts) with evidence. |
| Human-in-the-loop systems | 4 | | | Escape hatches, tone-based escalation, confirmation as a separate isolated question. The tone rule was your call and it was better than mine. |
| AI governance | **3** | | | `POLICY.md` with owners, machine-readable rules, known gaps. Scored lower than the artefacts suggest: you've governed *one* agent. Nothing yet on governing a fleet, or on who reviews a policy change. |
| Business applications of agents | **3** | | | Cost per conversation and per resolution, containment as a vanity metric. Thin on where an agent is the wrong answer — the "when not to build this" reflex. |

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
