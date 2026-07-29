# Project 3 — Golf Club Agent

> **Status:** not started · **Days:** 8–16 · **Prerequisites:** project 2

## Purpose

Build a realistic enterprise vertical agent: an AI receptionist for a golf club.

A golf club is a good teaching domain because it is genuinely multi-capability — knowledge questions, transactional bookings against a contended resource, membership administration, and emotionally-charged complaints — while being small enough to hold in your head. It is a real business with real constraints, not a toy.

## Capabilities

**Membership** — questions, fees, categories, renewals
**Operations** — tee bookings, competitions, events
**Customer service** — complaints, requests, escalation

## What you will learn

| Day | Concept |
|---|---|
| [8](../../curriculum/week-02/day-08.md) | Product requirements and jobs-to-be-done |
| [9](../../curriculum/week-02/day-09.md) | Knowledge systems, citations, abstention |
| [10](../../curriculum/week-02/day-10.md) | Business tools: idempotency, races, compensation |
| [11](../../curriculum/week-02/day-11.md) | Memory across sessions |
| [12](../../curriculum/week-02/day-12.md) | Human escalation and assisted mode |
| [13](../../curriculum/week-02/day-13.md) | Observability and cost attribution |
| [14](../../curriculum/week-02/day-14.md) | Production readiness review |
| [15](../../curriculum/week-03/day-15.md) | Architecture patterns — router, reflection, multi-agent |
| [16](../../curriculum/week-03/day-16.md) | Multi-step planning |

## Architecture

```
                        ┌──────────┐
        member  ───────▶│  ROUTER  │
                        └────┬─────┘
        ┌────────────────────┼──────────────────┐
        ▼                    ▼                  ▼
  ┌───────────┐      ┌──────────────┐    ┌────────────┐
  │ KNOWLEDGE │      │   BOOKINGS   │    │ COMPLAINTS │
  │ retrieval │      │ state machine│    │ → escalate │
  │ + cite    │      │ + hold/confirm│   │            │
  └───────────┘      └──────────────┘    └────────────┘
        │                    │                  │
        └────────────────────┼──────────────────┘
                             ▼
   ┌──────────────────────────────────────────────────┐
   │ policy · memory · escalation · tracing · evals    │
   │            (the shared substrate)                 │
   └──────────────────────────────────────────────────┘
                             │
                             ▼
        ┌──────────────┬──────────────┬─────────────┐
        │  tee-sheet   │  membership  │  handbook   │
        │  API (fake)  │  CRM (fake)  │  + fees.yaml│
        └──────────────┴──────────────┴─────────────┘
```

The shared substrate at the bottom is what becomes the platform in [project 4](../04-agent-factory/). Build it with that in mind.

## Structure

```
03-golf-club-agent/
├── PRD.md                        # day 8
├── PRODUCTION_REVIEW.md          # day 14
├── FAILURE_ANALYSIS.md           # day 14
├── IMPROVEMENT_PLAN.md           # day 14
├── RUNBOOK.md                    # day 14 / 20
├── knowledge/
│   ├── handbook.md               # narrative — retrieved
│   ├── competition-rules.md
│   ├── dress-code.md
│   └── structured/
│       ├── fees.yaml             # facts — exposed as tools
│       └── hours.yaml
├── fake-services/
│   └── tee-sheet/                # standalone hostile HTTP service
├── src/
│   ├── router.ts
│   ├── knowledge/                # chunking, FTS, citation enforcement
│   ├── booking/                  # state machine, hold/confirm, compensation
│   ├── memory/
│   ├── escalation/
│   ├── planning/                 # day 16
│   └── tools/
├── evaluation/
└── traces/
```

## The structured/unstructured split

The most important design decision in this project:

- **Facts** (fees, dates, opening times, limits) → YAML → **tools**. Exact, testable, auditable.
- **Narrative** (policies, procedures, explanations) → markdown → **retrieval with citations**.

Getting this split right will do more for accuracy than any retrieval tuning.

## The hostile tee-sheet

`fake-services/tee-sheet` is a real HTTP service with configurable failure injection:

```bash
npx tsx fake-services/tee-sheet --latency 3000 --error-rate 0.2 --flaky-writes
```

`--flaky-writes` commits then returns 500 — the ambiguous write. Your booking tool must not double-book when it retries. This is the hardest correctness problem in the project and it has nothing to do with AI.

## Done when

- [ ] PRD complete, with a v1 line and ≥ 10 anti-requirements
- [ ] Knowledge answers cited, with a measured abstention rate on unanswerable questions
- [ ] Bookings idempotent; concurrent race produces exactly one booking
- [ ] Ambiguous-write test passes — no double booking under retry
- [ ] Memory scoped per member, with an automated leakage test
- [ ] Escalation with a handoff package containing ATTEMPTED and NEEDED
- [ ] Assisted mode working for one high-stakes action
- [ ] Full traces; any conversation reconstructable from data alone
- [ ] Production review across nine dimensions, RAG-scored with evidence
- [ ] Honest failure analysis and prioritised improvement plan
