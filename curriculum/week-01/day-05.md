# Day 5 — Workflow Design

> Week 1 · Foundation · Project: [02-subscription-cancellation-agent](../../projects/02-subscription-cancellation-agent/)

## Objective

You can decide — with justification — how much of a process should be model-driven and how much should be code, and you have implemented a hybrid that is testable without an LLM.

This is the most commercially important day of week 1. It is the decision that separates agents that ship from agents that demo.

---

## Concepts

### The autonomy spectrum

"Should the LLM decide this?" is the central design question. It is not binary.

| Level | Who decides the next step | Predictability | Flexibility | Use when |
|---|---|---|---|---|
| 0 | Code. Fixed sequence. | Total | None | Regulated, high-stakes, well-understood |
| 1 | Code decides; model fills slots | Very high | Low | Forms, structured intake |
| 2 | **Code owns the stage machine; model acts within a stage** | High | Medium | ← **Most enterprise agents** |
| 3 | Model chooses from allowed tools; code enforces limits | Medium | High | Support, research, triage |
| 4 | Model plans freely | Low | Total | Exploration, internal tools |

The industry talks about level 4. Production runs on levels 2 and 3.

**The rule: use the least autonomy that solves the problem.** Every level of autonomy you add buys flexibility and pays for it in predictability, evaluability, and debuggability. Autonomy is not a virtue; it is a cost you incur when the problem genuinely requires it.

### Why level 2 wins in the enterprise

Business processes have **required ordering and non-negotiable preconditions**:

- You must verify identity **before** disclosing account details.
- You must offer retention **before** cancelling (if policy says so).
- You must confirm **before** an irreversible action.

If the LLM owns the ordering, then "did we verify before disclosing?" is a probabilistic question. That is unacceptable — for compliance, for evaluation, and for your own sanity.

So: **code owns the state machine; the model owns the conversation within each state.**

```
    ┌──────────┐  intent = cancel   ┌──────────────┐
    │ GREETING ├───────────────────▶│ VERIFICATION │
    └──────────┘                    └──────┬───────┘
                                           │ verified
                    ┌──────────────────────┘
                    ▼
             ┌──────────────┐   eligible    ┌───────────┐
             │  INSPECTION  ├──────────────▶│ RETENTION │
             └──────┬───────┘               └─────┬─────┘
                    │ not eligible                │ declined
                    │                             │
                    └──────────┬──────────────────┘
                               ▼
                     ┌───────────────────┐
                     │   CONFIRMATION    │  ← explicit yes required
                     └─────────┬─────────┘
                               ▼
                       ┌──────────────┐
                       │  EXECUTION   │  ← the only place a write happens
                       └──────┬───────┘
                              ▼
                        ┌──────────┐
                        │ COMPLETE │
                        └──────────┘

    any state ──▶ ESCALATED  (day 12)
```

Now the compliance question has a code answer: `cancel_subscription` is only in the tool set when `state === EXECUTION`, and `EXECUTION` is only reachable through `CONFIRMATION`. That is a **provable** property, testable without an LLM.

### The key mechanic: state-scoped tool sets

This is the technique to take away from today.

```ts
const toolsByState: Record<Stage, string[]> = {
  GREETING:     ["classify_intent"],
  VERIFICATION: ["find_customer", "verify_customer"],
  INSPECTION:   ["get_subscription", "get_usage"],
  RETENTION:    ["get_retention_offers", "apply_offer"],
  CONFIRMATION: [],                      // conversation only — no tools
  EXECUTION:    ["cancel_subscription"], // the only state with a write tool
  COMPLETE:     [],
};
```

The model cannot call a tool it cannot see. You have converted a prompt-engineering problem ("please don't cancel before confirming") into a code invariant. Prompts are guidance; tool scoping is enforcement.

Secondary benefits: fewer tools per call means better selection accuracy, smaller prompts, and lower cost.

### Deciding where the line goes

For each step in a process, ask:

1. **Is there a legally or commercially required order?** → code
2. **Would a wrong choice be expensive or irreversible?** → code
3. **Does it need judgement about ambiguous human language?** → model
4. **Can I write the rule in under 20 lines?** → code
5. **Do I need to prove it happened, in an audit?** → code

Most enterprise processes are 80% code, 20% model — and the 20% is exactly the part traditional software was bad at. That is where the value is. It is not a consolation prize; it is the whole point.

### Escape hatches

A rigid machine with no exits produces trapped users, which is worse than a chatbot. Every design needs:

- **Escalation** from any state (day 12)
- **Backwards transitions** — "actually, wrong account"
- **Abandonment** — user leaves; state persists; they return
- **Timeout** — a stage that never completes must resolve, not hang

---

## Architecture

```
   ┌───────────────────────────────────────────────┐
   │             Workflow Engine (code)            │
   │                                               │
   │   current stage ──▶ allowed tools             │
   │                 ──▶ stage system prompt       │
   │                 ──▶ transition guards         │
   │                 ──▶ required preconditions    │
   └──────────────────┬────────────────────────────┘
                      ▼
   ┌───────────────────────────────────────────────┐
   │        Agent loop (model, scoped)             │
   │   converses, calls permitted tools, proposes  │
   │   a transition — never performs one           │
   └──────────────────┬────────────────────────────┘
                      ▼
   ┌───────────────────────────────────────────────┐
   │  Transition guard (code): precondition met?   │
   │  yes → advance + persist   no → stay + reason │
   └───────────────────────────────────────────────┘
```

**The model proposes a transition; code performs it.** Same principle as tool calling. It is the recurring shape of this entire discipline.

Persist the stage on every transition. A dropped connection mid-cancellation must resume in the right place — and must not double-execute.

---

## Exercise

Continue in `projects/02-subscription-cancellation-agent/`.

**1. Draw the state machine before writing code.** By hand or in Mermaid. Save it to `docs/diagrams/cancellation-workflow.md`. Include the unhappy paths — that is where the design work is.

**2. Define stages as types**, with entry conditions, allowed tools, exit conditions, and a stage-specific prompt fragment.

**3. Implement state-scoped tool sets.** Confirm the model literally cannot see `cancel_subscription` outside `EXECUTION`.

**4. Implement transition guards as pure functions:**

```ts
function canTransition(from: Stage, to: Stage, ctx: TaskState): Guard {
  if (to === "EXECUTION" && !ctx.confirmedByUser)
    return { ok: false, reason: "Explicit confirmation required." };
  if (to === "EXECUTION" && !ctx.verified)
    return { ok: false, reason: "Customer not verified." };
  // ...
}
```

Pure functions. No I/O. **Unit-testable with zero API calls** — this is the point.

**5. Write the guard test suite.** Every illegal transition, asserted to fail. Aim for 20+ tests. They run in milliseconds and they encode your compliance requirements as executable specification.

**6. Persist stage transitions** with timestamp and reason. This is your audit trail and your day-13 observability source.

**7. Add the escape hatches:** escalation from anywhere, backwards transition on "wrong account", resume-after-abandonment.

**8. Run the process end to end**, five times, with different customer personalities: cooperative, confused, angry, evasive about verification, and one who changes their mind at confirmation. Record where it broke.

---

## Deliverable

- [ ] `docs/diagrams/cancellation-workflow.md` — the state machine, including unhappy paths
- [ ] Typed stage definitions with per-stage prompts and tool sets
- [ ] State-scoped tool exposure, verified
- [ ] Pure-function transition guards
- [ ] 20+ guard unit tests, passing, no API calls
- [ ] Persisted transition log
- [ ] Escape hatches implemented
- [ ] `docs/architecture/workflow-vs-autonomy.md` — where you drew the line and why
- [ ] `journal/day-05.md` — the five-persona results

---

## Reflection

1. Which steps did you give to the model, and which to code? For each model-owned step, what would it cost you if it chose wrong?
2. Your guard tests run without an API key. Why does that matter more than it first appears?
3. A user says "actually I want to change my plan instead" during `CONFIRMATION`. What should happen? Is that a transition, a new workflow, or an escalation?
4. What breaks if you flatten this to level 4 — one prompt, all tools, full autonomy? Name three specific failures.
5. What is the *cost* of the state machine? Be honest — where does it make the product worse, and how would you notice?

---

## Interview Question

> "Would you use a state machine or let the LLM plan? Argue both sides, then tell me what you'd actually build for a subscription cancellation flow."

The best answers refuse the false choice and describe the hybrid: code owns ordering, preconditions, and irreversible actions; the model owns language understanding and conversation within a stage. Key evidence of depth: state-scoped tool sets as *enforcement* rather than prompt instruction; the point that a state machine makes the system evaluable stage-by-stage; and honesty about the cost — rigidity, more code, worse handling of genuinely novel requests, which is what escalation is for. Someone who argues purely for autonomy usually hasn't operated one.

---

**Next:** [Day 6 — Policies and guardrails](day-06.md)
