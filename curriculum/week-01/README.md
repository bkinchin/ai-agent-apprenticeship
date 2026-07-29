# Week 1 — Foundation

**Outcome:** you can build a tool-using, policy-bound, evaluated agent from first principles, with no framework.

| Day | Topic | Project | Key deliverable |
|---|---|---|---|
| [1](day-01.md) | What is an AI agent? | [01](../../projects/01-hello-agent/) | Multi-turn REPL; your own definition of an agent |
| [2](day-02.md) | Conversation state | [01](../../projects/01-hello-agent/) | Session store + context assembler |
| [3](day-03.md) | Tool calling | [02](../../projects/02-subscription-cancellation-agent/) | Four tools, executor, agent loop |
| [4](day-04.md) | Structured outputs | [02](../../projects/02-subscription-cancellation-agent/) | Schemas + three-stage validation funnel |
| [5](day-05.md) | Workflow design | [02](../../projects/02-subscription-cancellation-agent/) | State machine with scoped tool sets |
| [6](day-06.md) | Policies and guardrails | [02](../../projects/02-subscription-cancellation-agent/) | Policy engine, audit log, red-team log |
| [7](day-07.md) | Evaluation | [02](../../projects/02-subscription-cancellation-agent/) | Golden set + baseline pass rate |

## The through-line

Each day adds one mechanism and one class of failure. By day 7 you have the complete minimal shape of a production agent — and, crucially, a **number** that tells you how good it is.

The recurring pattern, which you should notice by day 6: **the model proposes, code disposes.** Tool calls, state transitions, and policy decisions all follow it.

## Week 1 gate

Before starting week 2:

- [ ] Baseline pass rate recorded for project 2
- [ ] Zero policy violations in the eval suite
- [ ] Tests run without an API key
- [ ] Self-assessment scored in `journal/self-assessment.md`
