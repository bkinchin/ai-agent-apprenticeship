# Success Criteria

Read this on day zero. It is the target you are aiming at, and the standard you assess yourself against on day 21.

Each criterion has an **evidence** requirement. "I understand it" is not evidence. A written artefact, a running system, or a recorded explanation is.

---

## 1. Explain

You can explain each of these to a sceptical enterprise architect, in under three minutes, without notes.

| # | You can explain… | Evidence | Day |
|---|---|---|---|
| 1.1 | What makes an agent different from a chatbot | `docs/architecture/what-is-an-agent.md` | 1 |
| 1.2 | Why agents need state, and where it lives | `journal/day-02.md` + working session store | 2 |
| 1.3 | How agents use tools, and why tool design is the hard part | Tool schemas in project 2 | 3 |
| 1.4 | Why structured output matters and how you enforce it | Zod schemas + validation failure handling | 4 |
| 1.5 | How workflow and autonomy trade off | `docs/architecture/workflow-vs-autonomy.md` | 5 |
| 1.6 | How policies constrain agent behaviour, and why prompts are not policies | `shared/policies/` + policy tests | 6 |
| 1.7 | How evaluation works, and why it is harder than software testing | Working eval harness with a real pass rate | 7 |
| 1.8 | How memory differs from state, and its risks | Memory design note | 11 |
| 1.9 | How agents improve over time from production signal | `docs/architecture/improvement-loop.md` | 19 |

**Bar:** you can answer the follow-up question, not just the question.

---

## 2. Build

Working systems in this repository. Not slideware.

### Project 1 — Hello Agent
- [ ] Multi-turn conversation with persistent history
- [ ] You can articulate exactly what the model receives on turn *n*
- [ ] Token and cost accounting per turn

### Project 2 — Subscription Cancellation Agent
- [ ] Verifies the customer before acting
- [ ] Inspects subscription state via tools
- [ ] Offers retention according to a policy, not a prompt whim
- [ ] Cancels — with an irreversible-action confirmation step
- [ ] Confirms the result and leaves an audit trail
- [ ] Refuses to act outside policy, provably, under test
- [ ] Evaluation suite with a documented pass rate and known failure cases

### Project 3 — Golf Club Agent
- [ ] Answers membership, fees, and renewal questions from a knowledge source
- [ ] Handles tee bookings, competitions, and events via tools
- [ ] Handles complaints and escalates to a human on defined triggers
- [ ] Remembers a returning member across sessions
- [ ] Cites its sources; says "I don't know" when it doesn't
- [ ] Evaluated on a golden set of real-shaped queries

### Project 4 — Agent Factory
- [ ] Accepts a business specification (type, jobs, systems, tools, policies, metrics)
- [ ] Emits a complete agent: system prompt, goals, policies, tools, knowledge, evaluations, README
- [ ] The generated agent runs without hand editing
- [ ] You have generated a **fifth**, unplanned business agent to prove it generalises
- [ ] The generator itself is evaluated

### Cross-cutting
- [ ] Every project has: README, tests, evaluation, failure analysis, improvement plan
- [ ] Tests run without an API key (model calls are stubbed at a seam)
- [ ] Traces exist for every agent run

---

## 3. Discuss

You can hold your own in a senior technical conversation on:

| Topic | You can address |
|---|---|
| **Enterprise AI architecture** | Where the agent sits relative to systems of record; sync vs async; how it fails safely |
| **Agent reliability** | Failure taxonomy, retries, idempotency, partial completion, the non-determinism problem |
| **Human-in-the-loop** | Escalation triggers, handoff context, confidence and its limits, reviewer workload |
| **AI governance** | Auditability, PII, policy enforcement points, model change management, who is accountable |
| **Business applications** | Which processes suit agents, how to size the opportunity, deflection vs resolution, unit economics |

**Bar:** you can name the tradeoff and say which side you would take *and why*, for a specific business context.

---

## 4. Portfolio artefacts

By day 21 the repository contains:

- [ ] 21 journal entries
- [ ] 4 working projects
- [ ] At least 4 architecture decision notes in `docs/architecture/`
- [ ] At least 3 diagrams in `docs/diagrams/`
- [ ] A completed PRD, architecture doc, policy doc, and evaluation plan (from `templates/`)
- [ ] A failure analysis for each of projects 2, 3, 4
- [ ] Interview answer notes in `docs/interview-preparation/`
- [ ] A 10-minute demo you can deliver live

---

## Self-assessment scale

Score each of the nine "Explain" items and five "Discuss" topics on day 7, day 14, and day 21:

| Score | Meaning |
|---|---|
| 1 | I have heard of it |
| 2 | I can define it |
| 3 | I can explain it with an example |
| 4 | I can explain the tradeoffs and defend a choice |
| 5 | I can design an alternative and say when it would be better |

**Target on day 21: 4 or above on every item.** Anything at 3 or below names your next two weeks of work.

Record scores in `journal/self-assessment.md`.

---

## The final test

You are ready when you can be handed a business process you have never seen, and within an hour produce: the agent architecture, the tool inventory, the policy set, the escalation design, the evaluation plan, and an honest account of how it will fail.

That is the job. Everything in this repository exists to get you there.
