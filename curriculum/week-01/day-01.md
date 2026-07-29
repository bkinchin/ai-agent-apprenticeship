# Day 1 — What is an AI Agent?

> Week 1 · Foundation · Project: [01-hello-agent](../../projects/01-hello-agent/)

## Objective

By the end of today you can define an agent precisely enough to tell whether a given system is one, and you have a working multi-turn conversation running locally.

The definition matters more than the code. Most enterprise "agent" projects fail because nobody agreed what they were building.

---

## Concepts

### The stateless function underneath

A large language model is a pure function:

```
f(messages) -> message
```

No memory. No side effects. No ability to act. Every call is the first call. Everything that feels like intelligence, continuity, or agency is **scaffolding you build around this function**.

Internalise that now. It explains almost every design decision in the next three weeks.

### The ladder

There is no binary agent/not-agent line. There is a ladder, and each rung adds a capability and a failure mode.

| Rung | Name | Capability added | New failure mode |
|---|---|---|---|
| 0 | Prompt | Single request → response | Wrong answer |
| 1 | Chatbot | Conversation history | Context drift, cost growth |
| 2 | Tool-using assistant | Can read the world | Wrong tool, bad arguments |
| 3 | **Agent** | Can act on the world; loops until goal met | Wrong action, unrecoverable side effects |
| 4 | Autonomous agent | Sets its own sub-goals; long horizon | Unbounded behaviour, cost runaway |

An **agent** is rung 3: a system where an LLM **selects actions** in a **loop** against **external state**, in pursuit of a **goal**, under **constraints**.

Four load-bearing words:

- **Selects actions** — the model chooses, rather than a developer choosing for it. This is the source of both the value and the risk.
- **Loop** — it observes the result of its action and decides again. One-shot tool use is not an agent.
- **External state** — it changes something that outlives the conversation. This is what makes correctness matter.
- **Constraints** — goals without constraints is not an agent, it is an incident.

### The distinction that matters commercially

A chatbot that is wrong produces a bad answer. An agent that is wrong produces a **wrong action against a system of record** — a cancelled subscription, a refunded payment, an emailed customer.

That asymmetry is why the rest of this apprenticeship is disproportionately about evaluation, policy, and failure — not about prompting.

### The agent loop

Every agent, from 40 lines to a platform, is this:

```
  goal + context
        │
        ▼
    ┌───────┐
    │ THINK │  ← model decides: act, or finish?
    └───┬───┘
        │
   ┌────┴────┐
   │ act?    │──no──▶ respond, stop
   └────┬────┘
        │ yes
        ▼
    ┌───────┐
    │  ACT  │  ← execute a tool; deterministic code
    └───┬───┘
        │
        ▼
    ┌─────────┐
    │ OBSERVE │  ← result appended to context
    └────┬────┘
         │
         └──────▶ back to THINK  (bounded: max steps, max cost, max time)
```

The bound on the loop is not a detail. An unbounded loop is a production outage with an API bill attached.

---

## Architecture

Where an agent actually sits in an enterprise:

```
   Channel (web chat, phone, email, Slack)
        │
        ▼
   ┌──────────────────────────────────┐
   │           Agent Runtime          │
   │  ┌────────────┐  ┌────────────┐  │
   │  │  Session   │  │   Policy   │  │
   │  │   state    │  │   engine   │  │
   │  └────────────┘  └────────────┘  │
   │  ┌────────────┐  ┌────────────┐  │
   │  │    LLM     │  │   Tools    │  │
   │  │  (vendor)  │  │  (yours)   │  │
   │  └────────────┘  └────────────┘  │
   └──────┬──────────────────┬────────┘
          │                  │
          ▼                  ▼
    Observability      Systems of record
    (traces, evals)    (CRM, billing, DB)
```

Three observations a product architect should make immediately:

1. **The LLM is one box out of six.** Vendor lock-in fears are usually misplaced; the value you build is the other five boxes.
2. **Tools are the integration surface.** The agent's real capability ceiling is the quality of the APIs you can expose to it, not the model.
3. **Observability is not optional.** A non-deterministic system without traces cannot be debugged, only guessed at.

---

## Exercise

Work in `projects/01-hello-agent/`.

**1. Set up.**

```bash
cd projects/01-hello-agent
npm init -y && npm i openai zod dotenv && npm i -D typescript tsx @types/node
npx tsc --init
```

Put `OPENAI_API_KEY` in the repo-root `.env`.

**2. Build a single-turn call.** One file, `src/index.ts`. Send a message, print the response. Print the token usage from the API response too — you should see cost from minute one.

**3. Make it multi-turn.** A REPL loop reading from stdin. Maintain a `messages` array. Send the whole array every time.

**4. Prove the model is stateless.** Add a `--forget` flag that sends only the latest message. Ask a two-turn question ("My name is Billy" / "What's my name?") with and without it. Watch it fail. This is the single most important thing you will observe this week.

**5. Log what you send.** Add a `--verbose` flag that prints the full `messages` array before each call. Look at it. That array *is* the agent's entire world.

**6. Classify five systems.** In `journal/day-01.md`, place these on the ladder (0–4) and justify each in one sentence: a customer-service FAQ bot; GitHub Copilot autocomplete; a CI pipeline that retries failed jobs; ChatGPT with browsing; a script that reads your inbox and drafts replies for approval.

---

## Deliverable

- [ ] `projects/01-hello-agent/src/index.ts` — working multi-turn REPL
- [ ] `--forget` and `--verbose` flags working
- [ ] `projects/01-hello-agent/README.md` — purpose, architecture, usage
- [ ] `docs/architecture/what-is-an-agent.md` — your own definition, the ladder, and where the boundary sits. **Your words, not this file's.**
- [ ] `journal/day-01.md` — including the five-system classification

---

## Reflection

Answer in `journal/day-01.md`:

1. The model is stateless. So what, precisely, creates the illusion of memory in a chat product?
2. What is the cost profile of a 50-turn conversation, if you resend all history every turn? Estimate it in tokens and dollars. What does that imply for a product with 100,000 daily conversations?
3. Name a process in a business you know well that is at rung 1 today and would be valuable at rung 3. What is the single most dangerous action that agent could take?
4. Where would you *refuse* to put an agent, and why? Be specific about the failure you are avoiding.

---

## Interview Question

> "A customer-service leader tells you they want to replace their chatbot with an AI agent. Walk me through the questions you'd ask before agreeing, and tell me what would make you recommend against it."

What a strong answer contains: the distinction between answering and acting; what systems of record are in scope and whether the actions are reversible; how correctness would be measured today (if they can't measure the chatbot, they can't measure the agent); the escalation path; who is accountable when it acts wrongly. A recommendation *against* is a strong signal — e.g. high-stakes irreversible actions with no audit trail, or no existing quality baseline to improve on.

---

**Next:** [Day 2 — Conversation state](day-02.md)
