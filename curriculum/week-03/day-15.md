# Day 15 — Agent Architecture Patterns

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can name, compare, and select between the standard agent architecture patterns, and you can justify *not* using a framework as readily as using one.

Week 3 shifts from building an agent to building a system that produces agents. That requires seeing the patterns beneath what you have built.

---

## Concepts

### The patterns

You have built two of these already without naming them. Naming them is what lets you generalise.

**1. Chain** — fixed sequence of model calls. No branching.
> Classify → extract → generate → validate. Predictable, cheap, testable. Not an agent, and often sufficient.

**2. Router** — a classifier picks one of N handlers.
> Underrated. Most "we need a multi-agent system" requirements are a router plus three chains, and the router version is testable.

**3. Tool-use loop (ReAct)** — think, act, observe, repeat. *(Days 3, 10.)*
> The default agent. Flexible, and hard to evaluate because the trajectory varies.

**4. State machine + LLM** — code owns transitions, model acts within a stage. *(Day 5.)*
> **The enterprise workhorse.** Predictable, auditable, evaluable stage by stage.

**5. Plan-and-execute** — generate a plan, then execute steps. *(Day 16.)*
> Good when the number of steps varies. Plans go stale, and replanning is the hard part.

**6. Reflection** — the agent critiques and revises its own output.
> Real quality gains on generative tasks. Doubles or triples cost. Cannot catch errors that require external truth — a model that doesn't know the fee cannot self-correct the fee.

**7. Supervisor / multi-agent** — an orchestrator delegates to specialists.
> Genuinely useful when sub-tasks need different tools, knowledge, or policies. **Usually adopted far too early.**

**8. Evaluator-optimiser** — a generator and a separate critic loop until a bar is met.
> Powerful for content generation with a checkable standard. Needs a stopping condition.

### Choosing

```
Is the sequence fixed?                    ── yes ─▶ CHAIN
       │ no
Is it "one of N known things"?            ── yes ─▶ ROUTER
       │ no
Is there a required order or a
regulated/irreversible step?              ── yes ─▶ STATE MACHINE  ← enterprise default
       │ no
Does step count vary with the request?    ── yes ─▶ PLAN-EXECUTE
       │ no
Is output quality subjective and
improvable by critique?                   ── yes ─▶ + REFLECTION
       │ no
                                                 ─▶ TOOL-USE LOOP
```

Multi-agent is not on this path deliberately. It is a *scaling* decision, taken when a single agent's tool count or policy surface has become unmanageable — not a starting architecture.

### The multi-agent question

The honest position, which you should be able to defend:

**Costs of multi-agent:** context handoff loses information; latency multiplies; cost multiplies; debugging spans multiple traces; failure modes compound; evaluation becomes much harder.

**Legitimate reasons to split:**

1. Different sub-tasks need genuinely different **tool sets** (>20 tools total)
2. Different **policies** apply (a sales agent and a support agent have different rules)
3. Different **teams own** different parts (a real and valid organisational reason)
4. Different **knowledge domains** with no overlap
5. Different **latency or cost** profiles (cheap classifier in front of an expensive reasoner)

**Illegitimate reasons:** it seems more sophisticated; a blog post said so; "specialised agents perform better" (a system prompt is cheaper than a process boundary).

Rule of thumb: **split at the point where you would split a team, not where you would split a function.**

### The framework question

You have built by hand: a tool loop, state management, structured output, policy enforcement, evaluation, memory, and tracing. Now you can evaluate frameworks properly.

| Framework | Gives you | Costs you |
|---|---|---|
| **LangGraph** | Graph execution, checkpointing, streaming, human-in-loop primitives | Abstraction over your control flow; debugging through their layer |
| **OpenAI Agents SDK** | Tool loop, handoffs, guardrails, tracing | Provider coupling |
| **MCP** | Standard tool protocol, reusable servers, ecosystem | A protocol layer; an operational surface |
| **Vector DBs** | Semantic retrieval at scale | Infra, embedding cost, chunking complexity |

The questions to ask of any of them:

1. What does it do that my 200 lines don't?
2. What does it make *harder*? (Usually: debugging and doing something slightly unusual.)
3. What does it lock in?
4. Can I still see and control the actual prompt?
5. What happens when I need something it doesn't support?

**Adopt when the framework solves a problem you have measured, not one you anticipate.** LangGraph's durable checkpointing is genuinely valuable if you have long-running agents that must survive process restarts — and worthless if your conversations last 90 seconds.

MCP is the most likely to be a genuine win, because it is a *protocol* rather than a framework: it standardises the tool boundary you already built, without owning your control flow.

---

## Architecture

Patterns compose. A realistic enterprise design:

```
                      ┌──────────┐
       message  ──────▶  ROUTER  │  cheap classifier
                      └────┬─────┘
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ┌──────────┐   ┌──────────────┐   ┌──────────┐
    │  CHAIN   │   │STATE MACHINE │   │  ROUTER  │
    │ FAQ /    │   │  bookings    │   │complaints│
    │knowledge │   │  (day 5)     │   │→ human   │
    └──────────┘   └──────┬───────┘   └──────────┘
                          ▼
                   ┌──────────────┐
                   │ TOOL LOOP    │  within a stage
                   └──────────────┘

    shared: policy engine · tracing · escalation · memory · evals
```

The bottom line is the important one. **The shared substrate is the platform.** Recognising that is what makes project 4 possible.

---

## Exercise

**1. Classify what you built.** Document the patterns in projects 2 and 3, honestly, including where you drifted between them.

**2. Implement the router pattern.** Add a front-door classifier to the golf club agent routing between knowledge, bookings, complaints, and membership. Measure classification accuracy on 30 cases. Measure the cost and latency change versus the single-agent version.

**3. Implement reflection on one task.** Have the agent draft a complaint response, critique it against a rubric, and revise. Measure quality (LLM judge from day 7) and cost, before and after. **Report both — and say whether it was worth it.**

**4. Build a deliberately over-engineered multi-agent version** of one flow: a supervisor delegating to a booking specialist and a knowledge specialist. Then measure it against your single-agent version on the same golden set: accuracy, latency, cost, and — subjectively — debugging difficulty.

**5. Write up the multi-agent comparison honestly.** In most cases the single agent wins. If yours doesn't, that is more interesting and you should say why.

**6. Framework evaluation.** Pick **one** of LangGraph, the OpenAI Agents SDK, or MCP. Rebuild one narrow slice of an existing agent with it — not the whole thing. Then write `docs/architecture/framework-evaluation.md` answering the five questions above, with a recommendation.

**7. Draw the pattern decision tree** in `docs/diagrams/`, annotated with your own experience.

---

## Deliverable

- [ ] Pattern classification of projects 2 and 3
- [ ] Router implemented, with measured accuracy, cost, and latency
- [ ] Reflection implemented, with a measured quality/cost tradeoff and a verdict
- [ ] Multi-agent version built and **measured against** the single agent
- [ ] `docs/architecture/agent-patterns.md` — the comparison table with your numbers
- [ ] `docs/architecture/framework-evaluation.md` — one framework, tried, with a recommendation
- [ ] `docs/diagrams/pattern-decision-tree.md`
- [ ] `journal/day-15.md`

---

## Reflection

1. What did the multi-agent version cost in latency and money? Did it gain anything measurable?
2. Was reflection worth the cost on your task? Where would it be, and where would it definitely not be?
3. What information was lost at the supervisor→specialist handoff? How would you have noticed in production?
4. Which framework did you evaluate, and would you adopt it? What specific measured problem does it solve for you?
5. Where does the golf club agent's architecture now look wrong, given what you can name?

---

## Interview Question

> "When would you use a multi-agent architecture?"

This question is a trap for people who have read about agents but not run them. The strong answer leads with the costs — context loss at handoffs, multiplied latency and cost, harder debugging and evaluation — and then gives the legitimate triggers: genuinely distinct tool sets, distinct policies, distinct team ownership, or distinct cost/latency profiles. The best framing: split where you would split a team, not where you would split a function. Strong candidates also note that a router plus specialised prompts gets most of the benefit at a fraction of the cost, and that they would start single-agent and split on measured evidence — usually tool-selection accuracy degrading as the tool count grows.

---

**Next:** [Day 16 — Multi-step planning](day-16.md)
