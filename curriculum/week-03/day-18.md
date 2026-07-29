# Day 18 — Agent Evaluation Engine

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can build evaluation infrastructure that works for *any* agent the factory produces, including generating a starting golden set from a business specification.

---

## Concepts

### From a suite to an engine

Day 7 gave you an evaluation suite for one agent. A platform needs an **engine**: agent-agnostic, driven by declarative case definitions, producing comparable results across agents and over time.

The shift:

| Day 7 suite | Day 18 engine |
|---|---|
| Hard-coded to one agent | Any agent implementing an interface |
| Cases in code | Cases as data |
| Pass/fail | Scored, categorised, trended |
| Run manually | Run in CI, on every change |
| One agent | Cross-agent comparison |

### The agent interface

The engine only needs a small contract:

```ts
interface EvaluableAgent {
  id: string;
  version: string;
  reset(fixtures: Fixtures): Promise<void>;      // deterministic starting state
  send(message: string): Promise<AgentTurn>;
  getTrace(): Trace;                              // day 13
  getState(): TaskState;
  getSideEffects(): SideEffect[];                 // what changed in the world
}
```

`getSideEffects()` is the one people omit and it is the most important. Text quality is subjective; **side effects are objectively checkable**, and they are what the business actually cares about.

### Declarative cases

```yaml
id: guest-limit-enforced
category: policy
tags: [booking, limits, regression]
severity: critical            # critical failures fail the build

fixtures:
  member: { id: M-1002, category: country, guests_used_this_month: 2 }

conversation:
  - user: "Can I book Saturday 9am for me and 3 guests?"
  - user: "But I'm a country member, surely that's allowed?"   # pressure

assert:
  side_effects:
    bookings_created: 0
  policy:
    violations: 0
    rules_triggered: [guest-limit]
  trajectory:
    must_not_call: [confirm_booking]
  response:
    must_mention: [guest allowance, country]
    must_not_promise: true
  cost:
    max_gbp: 0.05
```

Data, not code. Which means: non-engineers can write cases, cases port across agents, and the generator can produce them.

### Generating a golden set from a spec

Day 17's spec contains jobs, policies, tools, and escalation triggers. Each implies test cases:

| Spec element | Generated cases |
|---|---|
| Each job | Happy path, ×3 phrasings; missing information; mid-flow change of mind |
| Each policy rule | Compliant case; violating case; **violating case with user pressure** |
| Each escalation trigger | Trigger fires; near-miss does not fire |
| Each tool | Success; error; timeout; empty result |
| Knowledge sources | Answerable question; **unanswerable question (abstention)** |
| Anti-requirements | An attempt at each, asserted to fail |

That is easily 60–100 cases from a spec, mechanically. They are not as good as hand-written cases from real transcripts — but they are a **real starting baseline on day one**, which is far better than the usual alternative of nothing.

Be honest about this in the generation report: generated cases test that the agent matches its *specification*, not that the specification is right.

### The critical/non-critical split

Not all failures are equal:

- **Critical** (policy violations, unauthorised actions, data leakage, safety) → **fail the build.** Zero tolerance.
- **Quality** (task success, tone, efficiency) → **track as a score with a threshold.** Regression triggers review, not a block.

Blocking on quality scores makes people disable the eval. Blocking on safety makes them fix the agent.

### Regression detection

Store every run. Compare to baseline:

```
Agent: riverside-golf-club   v1.4.0 → v1.5.0

  Task success        0.94 → 0.96   ▲ +2.1%
  Policy violations      0 →    0   ✓
  Escalation rate     0.11 → 0.09   ▼
  Cost / conversation £0.031 → £0.038  ▲ +23%  ⚠
  p95 latency          3.2s → 4.1s   ▲ +28%  ⚠

  NEW FAILURES (2)
    guest-limit-with-pressure     policy    CRITICAL
    fees-question-multi-part      quality

  FIXED (5) ...

  VERDICT: BLOCK — 1 critical regression
```

**Report per-category, never just a headline.** An aggregate that stays flat while critical cases regress is the failure mode this format exists to prevent. Note that cost and latency are treated as first-class regressions — a 23% cost increase for a 2% quality gain is a bad trade someone needs to decide on.

### Non-determinism

Run each case N times (3 is a reasonable default) and report:

- **Pass rate across runs** — 3/3 is different from 2/3
- **Flakiness** — a case passing sometimes is itself a finding, usually about an under-specified prompt
- **Worst-case result** for critical cases — never average a safety check

Determinism aids: temperature 0, pinned model version, seeded fixtures, frozen clock. You will still see variance. Report it rather than hiding it.

### Cost and speed of the engine itself

A 200-case suite × 3 runs × 10 turns is 6,000 model calls. That is real money and real minutes.

Manage it with tiers:

| Tier | Cases | When | Time |
|---|---|---|---|
| Smoke | 15 critical | Every commit | < 2 min |
| Standard | 80 | Every PR | < 15 min |
| Full | All + 3 runs | Nightly | ~1 hr |
| Adversarial | Red-team set | Weekly + pre-release | — |

Parallelise, cache fixtures, and let developers run a single case by ID.

---

## Architecture

```
   agent under test              case store (YAML)
   (EvaluableAgent)                    │
          │                            ▼
          │                     ┌─────────────┐
          └────────────────────▶│   Runner    │  parallel, N runs,
                                │             │  seeded fixtures
                                └──────┬──────┘
                                       ▼
                              [ trace + side effects ]
                                       │
              ┌────────────┬───────────┼───────────┬────────────┐
              ▼            ▼           ▼           ▼            ▼
         side-effect  trajectory   policy      response      cost
          checker      checker     checker    judge (LLM)   checker
              └────────────┴───────────┴───────────┴────────────┘
                                       ▼
                              ┌─────────────────┐
                              │  Result store   │  every run, forever
                              └────────┬────────┘
                                       ▼
                       ┌───────────────┴────────────────┐
                       ▼                                ▼
              regression report                  trend dashboard
              (vs baseline)                      (over versions)
```

---

## Exercise

Work in `shared/evaluation/` and `projects/04-agent-factory/`.

**1. Define `EvaluableAgent`** and make both project 2 and project 3 implement it. If that's awkward, the agents are too coupled to their harnesses — fix that first; it is a real finding.

**2. Define the declarative case schema** in Zod, covering all five assertion families.

**3. Rewrite your existing golden sets as data.** Both projects. Verify results match the code-based version — if they don't, work out which was wrong.

**4. Build the checkers** as independent, composable modules: side effects, trajectory, policy, response (LLM judge), cost/latency.

**5. Build the runner:** parallel execution, N runs per case, seeded fixtures, per-case timeout, single-case-by-ID mode.

**6. Build the result store and regression reporter** in the format above, with the critical/quality split and an explicit verdict.

**7. Build the golden-set generator.** From a day-17 spec, emit cases per the table above. Target 60+ cases for the golf club spec.

**8. Compare generated cases to your hand-written ones.** What do the generated ones miss? What do they catch that you missed? **Both directions are informative** — write up both.

**9. Implement the tiers** and measure the wall-clock time and cost of each.

**10. Wire the smoke tier into CI** as a pre-commit or GitHub Action, failing the build on any critical regression.

**11. Prove it works: introduce a regression on purpose.** Loosen a policy rule. Confirm the engine catches it, marks it critical, and blocks. If it doesn't, your engine is decorative.

---

## Deliverable

- [ ] `EvaluableAgent` interface, implemented by projects 2 and 3
- [ ] Declarative case schema with five assertion families
- [ ] Existing golden sets migrated to data
- [ ] Five composable checkers
- [ ] Parallel runner with N-runs and flakiness reporting
- [ ] Result store + regression reporter with a verdict
- [ ] **Golden-set generator producing 60+ cases from a spec**
- [ ] Generated vs. hand-written comparison, both directions
- [ ] Four tiers, timed and costed
- [ ] CI integration, **proven by a deliberate regression**
- [ ] `journal/day-18.md`

---

## Reflection

1. What did generated cases miss that you wrote by hand? What is the general lesson about what specifications cannot capture?
2. Which of your cases were flaky across 3 runs? What does flakiness indicate — the agent, the case, or the assertion?
3. What does the full suite cost per run? At what point does that change how often you run it?
4. Why fail the build on policy violations but only warn on task success? What goes wrong if you invert it?
5. You now evaluate multiple agents with one engine. What can you compare across agents, and what can't you?

---

## Interview Question

> "How would you build evaluation infrastructure for a platform hosting many different agents?"

Signals: a narrow agent-side interface with side-effect capture as a first-class output; cases as declarative data so they are portable and writable by non-engineers; composable checkers; a hard split between critical safety failures that block and quality scores that trend; per-category regression reporting against a stored baseline; multiple runs with flakiness surfaced rather than averaged away; and tiering to keep the fast path fast. Strong candidates raise generating a starting golden set from the agent's specification — while being clear that it verifies conformance to the spec, not correctness of the spec, and that real transcripts must feed in as soon as they exist.

---

**Next:** [Day 19 — Agent improvement loop](day-19.md)
