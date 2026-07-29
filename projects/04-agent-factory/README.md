# Project 4 — Agent Factory

> **Status:** not started · **Days:** 17–21 · **Prerequisites:** projects 2 and 3

## Purpose

Build a system that generates agents.

This is the final project and the portfolio headline. Building one agent shows competence. Building a system that produces agents shows you understood the domain well enough to abstract it — which is a different, and more senior, claim.

## The insight

Projects 2 and 3 are structurally near-identical. What varies is configuration; what stays constant is a platform.

| Varies by business | Constant across businesses |
|---|---|
| Jobs, tools, policies, knowledge, stages, eval cases, prompt content | Agent loop, tool executor, policy engine, retrieval, state machine engine, eval runner, escalation, tracing |

Generate the left column. Hand-build the right one, once.

## Input

A business specification — the real product of this project, because it encodes what you have to know about a business to build an agent for it.

```yaml
business:    { name, type, tone, languages }
jobs:        [ { id, description, frequency, checkable, reversibility, accuracy_target } ]
systems:     [ { id, kind, access, latency_ms, idempotency } ]
tools:       [ { id, job, system, kind, inputs, outputs } ]
policies:    [ { id, type, rule, on_exceed } ]
escalation:  { targets, triggers }
knowledge:   { sources, structured }
metrics:     [ { id, target, paired_with } ]
```

Every section maps to a day of the curriculum. That is the argument that the curriculum was the right shape.

## Output

```
generated/<business-slug>/
├── system_prompt.md
├── goals.yaml
├── policies.yaml
├── stages.yaml
├── tools/
│   ├── <tool>.schema.json
│   └── <tool>.impl.ts          ← STUB — a human implements this
├── knowledge/
│   ├── sources.yaml
│   └── README.md               ← what content is still needed
├── evaluations/
│   ├── golden-set.yaml         ← 60+ generated cases
│   └── metrics.yaml
├── README.md
└── GENERATION_REPORT.md        ← assumptions, gaps, human tasks
```

## Configuration, not code

The generator emits **configuration that the runtime validates before use** — not executable code.

Why: the runtime is the part that must be reliable, and generated code is the part you cannot trust. Tool implementations — where day 10 taught you the expensive bugs live — stay human-written against a generated schema.

**The generated config is added to a fixed safety baseline that it cannot override.** The generator must not be able to generate away a guardrail. That is a structural property, tested.

## Architecture

```
   business spec (YAML)
          │
          ▼
   ┌────────────────┐  invalid ─▶ report naming missing fields
   │ Spec validator │
   └───────┬────────┘
           ▼
   ┌──────────────────────────────────────┐
   │       Generation pipeline            │
   │  prompt → goals → policies → tools → │
   │  stages → evals → README             │
   │  each stage validated by the         │
   │  component that will consume it      │
   └───────────────┬──────────────────────┘
                   ▼
   ┌──────────────────────────────────────┐
   │  Assembler:  fixed safety baseline   │
   │  + generated config + runtime        │
   └───────────────┬──────────────────────┘
                   ▼
        smoke test ──▶ generated agent + report
```

## Structure

```
04-agent-factory/
├── src/
│   ├── spec/
│   │   ├── schema.ts             # the Zod spec schema — the core artefact
│   │   └── examples/
│   │       ├── golf-club.yaml
│   │       └── dental-practice.yaml
│   ├── generate/
│   │   ├── pipeline.ts
│   │   ├── stages/               # one module per generation stage
│   │   └── validators/           # each validates against its consumer
│   ├── assemble/
│   │   ├── assembler.ts
│   │   └── safety-baseline/      # NOT generatable
│   └── report.ts
├── generated/                    # output (gitignore all but examples)
└── README.md
```

The platform itself lives in [`shared/`](../../shared/) — extracted from project 3 on day 17.

## Evaluation of the factory

The generator is itself evaluated (day 18):

- Generated agents pass a smoke test
- The regenerated golf club scores within a defined margin of the hand-built one
- Generated golden sets cover every job, policy, escalation trigger, and anti-requirement
- The safety baseline survives a spec that attempts to remove it

## Done when

- [ ] Spec schema in Zod, every field traceable to a curriculum concept
- [ ] Platform extracted to `shared/`, **with project 3 passing its evals on it**
- [ ] Pipeline with per-stage validation against the consuming component
- [ ] Safety baseline proven un-overridable
- [ ] Golf club regenerated and scored against the hand-built version
- [ ] **A fifth, unplanned business generated and conversing** — the generalisation proof
- [ ] Golden-set generator producing 60+ cases from a spec
- [ ] Generation report listing assumptions and human tasks
- [ ] Time-from-spec-to-working-agent measured — the business case
