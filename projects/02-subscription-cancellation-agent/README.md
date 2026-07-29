# Project 2 — Subscription Cancellation Agent

> **Status:** not started · **Days:** 3–7 · **Prerequisites:** project 1

## Purpose

Learn production agent fundamentals on a process with real consequences.

Cancellation is chosen deliberately: it involves identity verification, an irreversible action, a commercial retention step with a legal boundary, and a customer who is often unhappy. Every constraint that makes enterprise agents hard is present in a process small enough to build in five days.

## Capabilities

1. Understand the customer's intent
2. Verify the customer's identity
3. Inspect the subscription
4. Offer retention, per policy
5. Cancel the subscription
6. Confirm the result and leave an audit trail

## What you will learn

| Day | Concept | Applied to |
|---|---|---|
| [3](../../curriculum/week-01/day-03.md) | Tool calling | Four tools, an executor, an agent loop |
| [4](../../curriculum/week-01/day-04.md) | Structured outputs | Intent classification, validation funnel |
| [5](../../curriculum/week-01/day-05.md) | Workflow design | Seven-stage state machine, scoped tool sets |
| [6](../../curriculum/week-01/day-06.md) | Policies | Policy engine, audit log, red-teaming |
| [7](../../curriculum/week-01/day-07.md) | Evaluation | Golden set, trajectory assertions, calibrated judge |

## Architecture

```
    ┌──────────┐   ┌──────────────┐   ┌────────────┐   ┌───────────┐
    │ GREETING │──▶│ VERIFICATION │──▶│ INSPECTION │──▶│ RETENTION │
    └──────────┘   └──────────────┘   └────────────┘   └─────┬─────┘
                                                             │
         ┌───────────────────────────────────────────────────┘
         ▼
   ┌──────────────┐   ┌───────────┐   ┌──────────┐
   │ CONFIRMATION │──▶│ EXECUTION │──▶│ COMPLETE │
   └──────────────┘   └───────────┘   └──────────┘
                       ▲ only stage with a write tool

   any stage ──▶ ESCALATED
```

**The core mechanic:** the tool set is scoped per stage. `cancel_subscription` is only visible to the model in `EXECUTION`, and `EXECUTION` is only reachable through `CONFIRMATION`. Compliance becomes a code invariant, not a prompt instruction.

Every tool call passes the policy engine before executing. Every call is audited.

## Structure

```
02-subscription-cancellation-agent/
├── src/
│   ├── agent.ts              # the loop
│   ├── schemas.ts            # Zod domain schemas
│   ├── workflow/
│   │   ├── stages.ts         # stage definitions + tool sets
│   │   └── guards.ts         # pure-function transition guards
│   ├── tools/
│   │   ├── registry.ts
│   │   ├── executor.ts       # validate · policy · timeout · trace
│   │   └── *.ts
│   ├── policy/engine.ts
│   ├── data/                 # seeded SQLite backend
│   └── audit.ts
├── evaluation/
│   ├── golden-set.yaml
│   └── judges/
├── tests/
├── POLICY.md
├── EVALUATION_PLAN.md
└── README.md
```

## Tools

| Tool | Kind | Notes |
|---|---|---|
| `find_customer` | read | By email; handles not-found and multiple-match |
| `get_subscription` | read | Full state |
| `get_retention_offers` | read | Eligible offers for the plan |
| `cancel_subscription` | **write** | Reason enum required · idempotent · `EXECUTION` only |
| `issue_goodwill_credit` | **write** | Hard-capped (day 6) |

## Test data

The seeded database deliberately contains awkward cases: a customer with two subscriptions, one already cancelled, one in trial, one past due, and one on an annual contract. Real data is not tidy; the agent must survive it.

## Done when

- [ ] Full happy path works end to end
- [ ] Cannot cancel without verification or confirmation — **proven by test, not by trying**
- [ ] Goodwill cap unbreakable under a documented red-team attempt
- [ ] 25+ policy tests and 20+ guard tests, all passing without an API key
- [ ] 20-case golden set with a recorded baseline pass rate
- [ ] One calibrated LLM judge with ≥ 80% human agreement
- [ ] Audit log from which a regulator could reconstruct any session
- [ ] Failure analysis written and categorised by root cause
