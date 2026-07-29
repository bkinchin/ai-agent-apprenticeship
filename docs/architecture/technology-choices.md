# Technology Choices

The stack for this apprenticeship, and — more importantly — what is deliberately excluded and when to reconsider.

---

## The stack

| Choice | Reason |
|---|---|
| **TypeScript** | Strong enterprise adoption, excellent AI ecosystem, types as documentation. Strict mode, always. |
| **Node.js 20+** | Built-in test runner and SQLite. Fewer dependencies to explain. |
| **Claude API** (`@anthropic-ai/sdk`) | Direct API access, no abstraction layer hiding the request. You need to see the actual messages array. Its request shape also separates `system` from `messages` structurally, which makes the context-assembly seam (day 2) clearer than a provider that folds instructions into the message list. |
| **Zod** | One definition → TypeScript type, JSON Schema, and runtime validation. The seam between the probabilistic and deterministic halves of the system. |
| **SQLite** | A file. Zero operational cost. Fast enough to teach the shape of every storage problem in this programme. |

---

## Deliberately excluded

These are excluded **initially**, not permanently. Each has a re-evaluation trigger.

| Excluded | Why | Reconsider when |
|---|---|---|
| **Docker** | Adds a layer between you and the runtime while you are learning what the runtime does | Day 20 — deployment |
| **Kubernetes** | Operational complexity with no learning value at this scale | Not in 21 days |
| **LangGraph** | Abstracts the control flow you are here to understand | Day 15 — after you have built the loop, the state machine, and checkpointing by hand |
| **Agent SDKs** | Same reason. You cannot evaluate what a framework does for you until you have done it yourself | Day 15 |
| **Vector databases** | Almost never needed for corpora of the size in this programme | Day 9 — and only if measured retrieval accuracy on keyword search is insufficient |
| **MCP** | A protocol worth adopting, but only once you have a tool layer to standardise | Day 15 |
| **Observability SaaS** | You need to know what a trace must contain before you outsource collecting it | Day 13 — build the schema first, then consider |
| **Managed eval platforms** | Same | Day 18 |

---

## The rule

> **You may adopt a framework only after you can explain, in writing, what it does for you that your own code does not.**

That explanation goes in this directory, and it must answer:

1. What does it do that my code doesn't?
2. What does it make *harder*? (Usually debugging, and doing anything slightly unusual.)
3. What does it lock in?
4. Can I still see and control the actual prompt sent to the model?
5. What measured problem does this solve?

Question 5 is the one that matters. **Adopt when a framework solves a problem you have measured, not one you anticipate.**

---

## Why this ordering is the point

The excluded list is not asceticism. It is sequencing.

If you start with LangGraph, you learn LangGraph. If you start with a `while` loop and a `switch` statement, you learn what agents are — and then you can evaluate LangGraph in an afternoon, correctly, because you know exactly what it would be replacing.

The learner who can answer *"why use this framework?"* is worth considerably more than the one who can answer *"how do I use this framework?"* — and the second is available from documentation, while the first is not.

---

## Model selection

Pin the model version explicitly, in configuration, in every environment. A floating alias means your production behaviour changes when the provider ships an update, on their schedule, with no deploy and no notice. See [day 20](../../curriculum/week-03/day-20.md).

Use a cheaper model for classification and routing. Reserve the expensive one for the reasoning that actually needs it. This is usually the second-largest cost lever after reducing turn count.
