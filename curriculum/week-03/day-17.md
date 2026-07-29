# Day 17 — Agent Generation

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can build a system that takes a business specification and emits a working agent — and you can explain why the specification format is the hard part.

This is the beginning of the final project. Everything from days 1–16 becomes reusable infrastructure today.

---

## Concepts

### The insight

Look at projects 2 and 3. Different domains, and yet structurally near-identical:

| Varies by business | Constant across businesses |
|---|---|
| Jobs to be done | The agent loop |
| Tool implementations | Tool registration, validation, execution |
| Policy rules | The policy engine |
| Knowledge content | Retrieval and citation |
| Stage definitions | The state machine engine |
| Golden set cases | The evaluation runner |
| Escalation targets | The escalation mechanism |
| System prompt content | Prompt assembly |

**The left column is configuration. The right column is a platform.** Once you see that split, the Agent Factory is obvious: build the platform once, generate the configuration.

That is also the commercial insight, and it is what makes this project a portfolio piece rather than an exercise. The tenth agent should take a day, not a month.

### Two things that could be generated

Be precise about which you're building — they are very different systems.

**A) Configuration generation (recommended).** The runtime is fixed and hand-written. The generator emits prompts, policies, goals, tool *specifications*, knowledge structure, and eval cases. Tool implementations are written by a human against a schema the generator produced.

**B) Code generation.** The generator emits executable code including tool implementations.

Choose (A). Why: the runtime is the part that must be reliable, and generated code is the part you cannot trust. In (A), everything generated is **data that is validated before use**, and the executable parts are reviewed by a human. In (B) you get a system that produces plausible-looking code with subtle bugs in the tool layer — precisely where day 10 taught you the bugs are expensive.

Say this out loud in an interview and you will sound like someone who has thought about it.

### The specification is the product

The generator is a prompt and a validator. **The input schema is the hard, valuable part**, because it encodes what you have to know about a business to build an agent for it.

```yaml
business:
  name: Riverside Golf Club
  type: membership_sports_club
  tone: warm, professional, not stuffy
  languages: [en-GB]

jobs:                        # from day 8
  - id: book_tee_time
    description: Member books a slot for their group
    frequency: high
    checkable: true
    reversibility: reversible
    accuracy_target: 0.99

systems:                     # from day 8's integration inventory
  - id: tee_sheet
    kind: rest
    access: read_write
    latency_ms: 200
    idempotency: supported

tools:
  - id: check_availability
    job: book_tee_time
    system: tee_sheet
    kind: read
    inputs:  { date: date, window: enum[morning,afternoon,evening] }
    outputs: { slots: array<slot> }

policies:                    # from day 6
  - id: guest-limit
    type: limit
    rule: "guests per member per month <= category.guest_allowance"
    on_exceed: deny_with_explanation

escalation:                  # from day 12
  targets:
    - { team: membership,  hours: "09:00-17:00 Mon-Fri", sla_hours: 4 }
  triggers: [policy_denial, customer_request, emotional, vulnerability]

knowledge:
  sources: [{ path: handbook.md, freshness_days: 365 }]
  structured: [{ path: fees.yaml, expose_as_tool: get_membership_fees }]

metrics:                     # from day 8
  - { id: containment, target: 0.65, paired_with: task_success }
  - { id: task_success, target: 0.95 }
```

Notice: **every section maps to a day of this apprenticeship.** That is not a coincidence — it is the argument that the curriculum was the right shape.

Notice also that most fields are things a competent product person can answer, and the ones they cannot (idempotency support, latency) are exactly the ones that determine feasibility. **The spec is a discovery instrument as much as an input format.**

### Generation strategy

Not one giant prompt. A pipeline, with validation between stages:

```
spec ──▶ validate spec (Zod)
     ──▶ generate system prompt        ──▶ check: covers all jobs, tone, boundaries
     ──▶ generate goals.yaml           ──▶ check: schema
     ──▶ generate policies.yaml        ──▶ check: engine can parse & evaluate
     ──▶ generate tool schemas         ──▶ check: valid JSON Schema, names unique
     ──▶ generate stage machine        ──▶ check: reachable, no dead ends, guards valid
     ──▶ generate eval golden set      ──▶ check: category mix, runnable
     ──▶ generate README               ──▶ check: complete
     ──▶ ASSEMBLE ──▶ smoke test ──▶ output
```

Each stage is small, individually testable, and independently improvable. **Each stage validates its output before the next stage consumes it** — otherwise one bad generation corrupts everything downstream, and you debug a 4,000-line output instead of a 200-line one.

### Templates plus generation

Not everything should be generated. Use fixed templates with generated slots:

- **Fixed:** the runtime, the policy engine, the eval runner, the trace schema, project scaffolding, safety boilerplate
- **Generated:** business context, job descriptions, tone, policy rules, tool schemas, stage definitions, eval cases
- **Human-written:** tool implementations, credentials, anything touching money

The safety-critical parts should be template constants that the generator cannot alter. **The generator must not be able to generate away a guardrail.** Build that as a structural property: the generated config is *added to* a fixed safety baseline, never replacing it.

### Output structure

```
generated/riverside-golf-club/
├── system_prompt.md
├── goals.yaml
├── policies.yaml
├── stages.yaml
├── tools/
│   ├── check_availability.schema.json
│   └── check_availability.impl.ts      ← STUB, human implements
├── knowledge/
│   ├── sources.yaml
│   └── README.md                       ← what content is needed
├── evaluations/
│   ├── golden-set.yaml
│   └── metrics.yaml
├── README.md
└── GENERATION_REPORT.md                ← what was assumed, what's missing
```

`GENERATION_REPORT.md` matters more than it looks. It lists every assumption the generator made, every gap in the spec, and everything a human must complete before launch. **A generator that reports its own uncertainty is trustworthy; one that emits confident output is not.**

---

## Architecture

```
   business spec (YAML)
          │
          ▼
   ┌───────────────┐  invalid ─▶ error report naming missing fields
   │ Spec validator│
   └───────┬───────┘
           ▼
   ┌────────────────────────────────────┐
   │        Generation pipeline         │
   │  each stage: generate → validate   │
   │  → retry once → fail loudly        │
   └───────────────┬────────────────────┘
                   ▼
   ┌────────────────────────────────────┐
   │  Assembler                         │
   │  fixed safety baseline + generated │
   │  config + runtime scaffold         │
   └───────────────┬────────────────────┘
                   ▼
   ┌────────────────────────────────────┐
   │  Smoke test — does it boot and     │
   │  hold a 3-turn conversation?       │
   └───────────────┬────────────────────┘
                   ▼
            generated agent + generation report
```

---

## Exercise

**1. Write the spec schema in Zod first.** Before any generation. This is the day's core work — spend real time on it. Every field should trace to a day of the curriculum.

**2. Write two specs by hand:** re-specify the golf club, and specify something genuinely different — a dental practice, a car dealership service department, a self-storage business. The second one is what tests whether your schema generalises.

**3. Extract the platform.** Move the runtime, policy engine, eval runner, escalation, and tracing from project 3 into `shared/`. **Make project 3 run on the extracted platform and verify its eval suite still passes** — that is your proof the extraction was faithful.

**4. Build the generation pipeline**, one stage at a time. Start with the system prompt. Get it good before adding the next stage.

**5. Build a validator per stage.** The policy validator must actually load the YAML into the policy engine and evaluate a test case. Validation that only checks shape is not validation.

**6. Build the assembler**, with the fixed safety baseline that generated config cannot override. Test that: try to write a spec whose policies remove a required guardrail, and prove it fails.

**7. Generate the golf club agent from spec.** Run project 3's golden set against it. **How close is it to your hand-built version?** The gap is your improvement backlog and it is the most informative output of the day.

**8. Generate the second business.** Implement the tool stubs by hand. Get it holding a sensible conversation.

**9. Write `GENERATION_REPORT.md`** generation — assumptions, gaps, human tasks.

**10. Time it.** How long from spec to working agent? That number is the business case.

---

## Deliverable

- [ ] Zod spec schema, with every field traceable to a curriculum concept
- [ ] Two hand-written specs in different domains
- [ ] Platform extracted to `shared/`, **with project 3 passing on it**
- [ ] Generation pipeline with per-stage validation
- [ ] Assembler with an un-overridable safety baseline, proven
- [ ] Golf club regenerated and evaluated against the hand-built version
- [ ] Second business generated and conversing
- [ ] Generation report
- [ ] `journal/day-17.md` — including the time-to-agent number

---

## Reflection

1. How did the generated golf club agent score versus the hand-built one? What did the generator lose, and is that fixable in the pipeline or inherent?
2. Which spec fields did you find yourself unable to fill for the second business? What does that tell you about what the spec is really asking?
3. Why generate configuration rather than code? Where does that boundary get uncomfortable?
4. How would you stop the generator producing an unsafe agent? Is your safety baseline genuinely un-overridable, or just conventionally so?
5. Time from spec to working agent. What would it take to halve it?

---

## Interview Question

> "How would you let a non-engineer create a new agent?"

The strongest answers identify that the input specification — not the generator — is the product, and that it is really a structured discovery process: jobs, systems, policies, escalation, metrics. Then: generate configuration rather than code, because config can be validated by the runtime that consumes it and code cannot; keep safety-critical elements as fixed templates the generator cannot override; validate each generation stage against the component that will consume it; require a human to implement anything that writes to a system of record; and emit a report of assumptions and gaps rather than pretending completeness. Depth marker: recognising that the tool *implementations* are where the real risk lives and deliberately keeping a human there.

---

**Next:** [Day 18 — Agent evaluation engine](day-18.md)
