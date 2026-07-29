# AI Agent Apprenticeship

A 21-day intensive apprenticeship in **enterprise AI agent engineering**.

This is not a tutorial collection. It is a structured programme that produces four things:

1. A first-principles understanding of agent architecture.
2. A portfolio of working AI agents.
3. A production-style **Agent Factory** platform.
4. The ability to discuss agent design at an enterprise engineering level.

---

## Who this is for

Someone with strong product, engineering leadership, and enterprise software experience who is becoming an **AI Product Architect / Applied AI Engineer / Enterprise Agent Designer** — not a junior software engineer.

The emphasis is systems thinking, tradeoffs, and reliability. Coding speed is a side effect, not the goal.

---

## How to use this repository

Work **one day at a time**. Each day has a fixed shape:

| Section | Purpose |
|---|---|
| Objective | What you will be able to do afterwards |
| Concepts | The theory, from first principles |
| Architecture | How this appears in a production system |
| Exercise | The hands-on task |
| Deliverable | What must exist in the repo afterwards |
| Reflection | Questions you answer in `journal/` |
| Interview Question | A Sierra-style question to answer out loud |

A day is complete when the **deliverable exists** and the **journal entry is written**. Not before.

### The daily loop

```bash
# 1. Read the day
open curriculum/week-01/day-01.md

# 2. Work the exercise in the relevant project folder

# 3. Write the journal entry
cp journal/TEMPLATE.md journal/day-01.md

# 4. Commit
git add -A && git commit -m "day-01: <what you built>"
```

One commit per day, minimum. The git history is part of the portfolio.

---

## Repository map

```
curriculum/     21 days, grouped into 3 weeks
projects/       The four builds (see below)
shared/         Reusable primitives: prompts, tools, evaluation, memory, policies
docs/           Architecture notes, diagrams, interview prep, reading
templates/      PRD / Architecture / Policy / Evaluation document templates
journal/        Your daily reflections — the learning record
```

### The four projects

| # | Project | Teaches |
|---|---|---|
| 1 | [Hello Agent](projects/01-hello-agent/) | The LLM interaction model: messages, prompts, responses, history |
| 2 | [Subscription Cancellation Agent](projects/02-subscription-cancellation-agent/) | Production fundamentals: tools, state, policies, evaluation |
| 3 | [Golf Club Agent](projects/03-golf-club-agent/) | A realistic vertical agent: knowledge, memory, escalation |
| 4 | [Agent Factory](projects/04-agent-factory/) | A system that generates agents from a business specification |

Each project builds on the last. Project 4 is only possible because 1–3 forced the primitives into existence.

### The three weeks

| Week | Theme | Outcome |
|---|---|---|
| [1](curriculum/week-01/) | Foundation | You can build a tool-using, policy-bound, evaluated agent |
| [2](curriculum/week-02/) | Enterprise agent | You can ship a vertical agent with knowledge, memory, and observability |
| [3](curriculum/week-03/) | Agent platform | You can build a system that produces agents |

---

## Technology

Deliberately small at the start.

**Stack:** Node.js · TypeScript · Claude API (Anthropic SDK) · Zod · SQLite

**Deliberately excluded until you understand why you need them:** Docker, Kubernetes, LangGraph, vector databases, agent frameworks.

The rule: *you may adopt a framework only after you can explain, in writing, what it does for you that your own code does not.* That explanation goes in `docs/architecture/`.

See [docs/architecture/technology-choices.md](docs/architecture/technology-choices.md) for the full rationale.

---

## Setup

Prerequisites: Node.js 20+ and an Anthropic API key.

```bash
npm install
cp .env.example .env.local   # then add your ANTHROPIC_API_KEY
```

Project dependencies are installed per project, on the day you need them — not up front.

---

## Working with Claude Code

[CLAUDE.md](CLAUDE.md) configures Claude Code to act as a **Principal AI Engineer Mentor**: it teaches before coding, asks architecture questions, and challenges assumptions. If you find yourself receiving large blocks of unexplained code, the mentor contract has been broken — say so.

---

## Definition of done

The programme is complete when you can satisfy [SUCCESS_CRITERIA.md](SUCCESS_CRITERIA.md) — explaining, building, and discussing agents at an enterprise level. Read it now, on day zero, so you know what you are aiming at.

---

## Specification

The original brief for this repository is preserved at [REPOSITORY_SPEC.md](REPOSITORY_SPEC.md).
