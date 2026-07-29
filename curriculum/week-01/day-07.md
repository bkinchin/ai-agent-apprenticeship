# Day 7 — Evaluation

> Week 1 · Foundation · Project: [02-subscription-cancellation-agent](../../projects/02-subscription-cancellation-agent/)

## Objective

You can build an evaluation harness that tells you whether a change made your agent better, and you know its limits.

Without this, every subsequent change is a guess. This is the day that turns tinkering into engineering.

---

## Concepts

### Why testing isn't enough

Traditional tests assert deterministic outputs. Agents are non-deterministic, and correctness is often a judgement.

Both of these are correct answers:

> "I've cancelled your PRO subscription. It stays active until 14 August, then won't renew."
> "Done — your subscription will end on 14 August and you won't be charged again."

`assertEquals` is useless here. But something must be measurable, or you cannot improve.

**The resolution: evaluate behaviour and outcome, not text.** Did it verify before disclosing? Did it call `cancel_subscription` exactly once, with the right reason code? Is the subscription cancelled in the database? Did it stay within policy? Those are all deterministic assertions on a non-deterministic system.

Most of what matters about an agent is checkable this way. Reach for LLM judging only for what genuinely isn't.

### The evaluation pyramid

```
                 ╱╲
                ╱  ╲     Human review
               ╱    ╲    slow, expensive, ground truth
              ╱──────╲
             ╱        ╲   LLM-as-judge
            ╱          ╲  subjective quality, noisy
           ╱────────────╲
          ╱              ╲  Trajectory assertions
         ╱                ╲ did it do the right things,
        ╱                  ╲ in the right order?
       ╱────────────────────╲
      ╱                      ╲ Deterministic checks
     ╱                        ╲ policy, schema, side effects
    ╱──────────────────────────╲
```

Build bottom-up. Most teams start at the top — a vibes-based judge — and end up with a number they don't trust and can't act on.

### Layer 1 — Deterministic checks

Cheap, fast, unambiguous. Run on every commit.

- Did any tool call violate policy? (Must be 0.)
- Did every model output validate?
- Is the final database state correct?
- Was there exactly one write?
- Did it stay under the step and cost limits?

**Any policy violation is a hard build failure.** Not a metric to trend — a broken build.

### Layer 2 — Trajectory assertions

The *path* matters as much as the destination.

```ts
{
  id: "cancel-happy-path",
  input: [ "I want to cancel", "billy@example.com", "DOB 1979-04-02",
           "no thanks", "yes, cancel it" ],
  expect: {
    toolsCalled:   ["find_customer","verify_customer","get_subscription",
                    "get_retention_offers","cancel_subscription"],
    toolOrder:     "strict",
    stagesVisited: ["GREETING","VERIFICATION","INSPECTION",
                    "RETENTION","CONFIRMATION","EXECUTION","COMPLETE"],
    finalState:    { subscriptionStatus: "cancelled", reason: "not_using" },
    mustNotCall:   ["issue_goodwill_credit"],
    maxSteps:      12,
  }
}
```

This catches the class of bug where the right outcome was reached the wrong way — cancelled without offering retention, disclosed before verifying. Those are the expensive ones.

### Layer 3 — LLM-as-judge

For genuine quality: was the tone appropriate, was the explanation clear, did it avoid promising something it shouldn't?

Rules for making it usable:

- **Judge one dimension per call.** A single "quality 1–10" score is noise.
- **Give a rubric with anchored examples.** "3 = states the facts but doesn't acknowledge the customer's frustration."
- **Force a citation.** The judge must quote the span it is judging. Dramatically reduces invention.
- **Use a binary or 3-point scale.** LLMs cannot reliably distinguish 7 from 8.
- **Calibrate against humans.** Score 30 cases yourself, compare. If agreement is below ~80%, the rubric is broken, not the agent.
- **Never let the judge be the same prompt as the agent.** It will approve of itself.

Treat judge scores as *noisy indicators for trends*, never as gates. And measure the judge: an unvalidated judge is a random number generator with good manners.

### Layer 4 — Human review

Irreplaceable. Sample 20 real conversations weekly. Read them properly. You will find things no metric surfaced. Feed every interesting one back into the golden set — that is how the set stays alive.

### The golden set

Your most valuable asset. Not the prompt — the prompt is disposable. The golden set is what makes improvement possible.

Composition:

| Category | Share | Source |
|---|---|---|
| Happy paths | 20% | The obvious flows |
| Realistic variation | 30% | Real transcripts, paraphrased |
| Edge cases | 25% | Weird data, ambiguity, mid-flow changes |
| Adversarial | 15% | Injection, manipulation, abuse |
| Regressions | 10% | Every production bug, forever |

**Every production bug becomes a permanent test case.** This is non-negotiable and it is the mechanism by which the system stops getting worse.

Start at 20 cases. Real systems run 200–2,000. Quality beats quantity: 30 well-chosen cases beat 300 variations of hello.

### Metrics that matter

| Metric | Definition | Why |
|---|---|---|
| **Task success** | Correct outcome achieved | The headline |
| **Policy violation rate** | Must be 0 | Non-negotiable |
| **Escalation rate** | % handed to human | Rising = degradation; zero = suspicious |
| **Turns to resolution** | Median | Efficiency and user patience |
| **Cost per conversation** | Tokens × price | Unit economics |
| **Containment** | % resolved without human | The business case |

**Containment without a satisfaction or accuracy measure is a vanity metric.** An agent that resolves 100% of conversations by refusing everything has perfect containment. Always pair it.

### The trap: eval overfitting

You will tune the prompt until the golden set passes, and production quality will not move. Guard against it:

- Hold out 20% of cases and never look at them during tuning.
- Refresh from production monthly.
- Track eval score *and* a production metric. When they diverge, trust production.

---

## Architecture

```
   golden set (JSON/YAML)
          │
          ▼
   ┌─────────────┐
   │   Runner    │ ── seeded fixtures, stubbed clock,
   │             │    pinned model + fixed effort
   └──────┬──────┘
          ▼
     [ full trace per case ]
          │
    ┌─────┼─────┬──────────┐
    ▼     ▼     ▼          ▼
  determ. traj. judge   side-effect
  checks  asrt.        verification
    └─────┴─────┴──────────┘
          ▼
   ┌─────────────┐
   │   Report    │  pass rate, per-category, regressions,
   │             │  cost, diff vs last run
   └─────────────┘
```

**Determinism where you can get it:** pinned model, fixed reasoning effort, seeded database reset per case, frozen clock.

Note the absence of a temperature knob. Current Claude models reject `temperature`, `top_p`, and `top_k` outright — a request carrying one returns a 400. This is worth sitting with rather than working around: **the industry's habitual "set temperature 0 for reproducibility" was always a comfort blanket.** It never guaranteed identical outputs, and believing it did let teams skip building real evaluation. You do not get a determinism dial. You get measurement.

So: run important cases 3× and report the **worst** result, never the average. Averaging hides the failure mode you care about, and a case that passes 2 out of 3 times is a finding, not a pass.

---

## Exercise

Continue in `projects/02-subscription-cancellation-agent/`.

**1. Write the evaluation plan first**, using `templates/EVALUATION_TEMPLATE.md`. Define what success means *before* you measure it.

**2. Build the runner** in `shared/evaluation/`. It must: reset the DB per case, run a scripted conversation, capture the full trace, apply checkers, emit a report. Design it for reuse — projects 3 and 4 will use it.

**3. Build a 20-case golden set** with the mix above. Write them yourself; the act of choosing cases is the learning.

**4. Implement deterministic checkers.** Policy violations, schema validity, final DB state, write-count, step and cost limits.

**5. Implement trajectory assertions.** Tools called, order, stages visited, forbidden tools.

**6. Implement one LLM judge** on a single dimension — clarity of the cancellation confirmation. Rubric, 3-point scale, required citation.

**7. Calibrate the judge.** Score 15 outputs yourself first. Compare. Report agreement. If it's below 80%, fix the rubric and repeat. **Do not skip this step** — it is what separates a real evaluation from theatre.

**8. Run it. Record the baseline.** Whatever the number is, write it down. This is the number every future change is measured against.

**9. Fix the top failure. Re-run. Confirm the delta.** Then check nothing else regressed. That loop — measure, change, re-measure — is the whole discipline.

**10. Write the week-1 failure analysis.** Every failing case, categorised: prompt problem, tool problem, workflow problem, policy problem, or model limitation. The distribution tells you where to work next week.

---

## Deliverable

- [ ] Evaluation plan from the template
- [ ] Reusable runner in `shared/evaluation/`
- [ ] 20-case golden set with documented category mix
- [ ] Deterministic checkers + trajectory assertions
- [ ] One calibrated LLM judge with reported human agreement
- [ ] **Baseline report with a real pass rate**
- [ ] One improvement, measured
- [ ] `docs/architecture/evaluation-strategy.md`
- [ ] `journal/day-07.md` — failure analysis + week-1 retrospective

---

## Reflection

1. What is your baseline pass rate? Which category failed most? What does that tell you about where the weakness actually is?
2. What was your judge–human agreement? If you had to defend that judge to a sceptical stakeholder, could you?
3. Your eval passes 95% and production users complain. List five reasons that can both be true.
4. What does it cost — in money and wall-clock time — to run the full suite? At what point does that stop you running it on every change, and what do you do then?
5. **Week-1 retrospective:** which of the six concepts (state, tools, structured output, workflow, policy, evaluation) do you understand least well? That is your week-2 focus.

---

## Interview Question

> "How do you know your agent is working? And how would you know it got worse after a model upgrade?"

Depth signals: the pyramid, and building it bottom-up; the insight that most agent correctness is deterministically checkable if you evaluate trajectory and side effects rather than text; a golden set that is versioned, categorised, and fed by production incidents; judges that are calibrated against humans and used for trends not gates; holdout sets to detect overfitting. On the model upgrade: run both versions against the golden set, compare per-category not just headline, shadow-run on production traffic, stage the rollout, and watch leading indicators — validation failure rate, escalation rate, step count — which move before the outcome metrics do. Anyone who says "we test it manually" is telling you they have no ability to change the system safely.

---

**Week 1 complete.** You have built a policy-bound, evaluated, tool-using agent from first principles. Before starting week 2, update `journal/self-assessment.md` with your day-7 scores against [SUCCESS_CRITERIA.md](../../SUCCESS_CRITERIA.md).

**Next:** [Day 8 — Product requirements and jobs-to-be-done](../week-02/day-08.md)
