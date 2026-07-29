# Day 19 — Agent Improvement Loop

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can build a closed loop that turns production signal into measured improvement, and you can decide correctly *which layer* to fix a problem in.

---

## Concepts

### The loop

```
   production traffic
          │
          ▼
   ┌──────────────┐
   │   SIGNAL     │  traces · escalations · thumbs · complaints ·
   │  collection  │  eval failures · leading indicators
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  TRIAGE      │  cluster · frequency × impact ÷ effort
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  DIAGNOSE    │  which LAYER is at fault?   ← the skill
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  FIX         │  smallest change at the right layer
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  VERIFY      │  eval before/after · new case added permanently
   └──────┬───────┘
          ▼
   ┌──────────────┐
   │  DEPLOY      │  staged · monitored · rollback ready
   └──────┬───────┘
          └────────▶ back to signal
```

Most teams have signal and fixes. They lack triage, layer diagnosis, and verification — so they change prompts, feel productive, and never establish whether anything improved.

### The layer diagnosis — today's core skill

When an agent behaves wrongly, the fix could go in seven places. **Choosing wrong is the most common and most expensive mistake in this field**, because the prompt is the easiest layer to change and almost never the right one.

| Layer | Symptom | Fix | Cost | Durability |
|---|---|---|---|---|
| **Prompt** | Tone, format, minor emphasis | Edit prompt | Minutes | **Fragile** — breaks on model change |
| **Tool description** | Wrong tool chosen, bad arguments | Rewrite description | Minutes | Good |
| **Tool interface** | Model can't express the right thing | Redesign the tool | Hours | **Excellent** |
| **Knowledge** | Wrong or missing facts | Fix the source | Hours | Excellent |
| **Policy** | Should have been prevented | Add a rule | Hours | **Excellent — permanent** |
| **Workflow** | Wrong order, missing step | Change the state machine | Days | Excellent |
| **Model** | Genuine reasoning failure | Change model, or route this case | Varies | — |

**The heuristic: if you can move a fix down this table, do.** A policy rule is permanent and testable; a prompt instruction is a request the next model version may ignore.

Worked example — *the agent quoted last year's green fee*:

- ✗ Prompt fix: "always check the current year's fees" — fragile, unverifiable, will regress
- ✓ Knowledge fix: fees were in prose in the handbook → move to `fees.yaml`
- ✓ Tool fix: expose `get_green_fee(date)` so the answer is a lookup, not retrieval
- ✓ Policy fix: never state a price without calling the fee tool
- ✓ Eval fix: permanent regression case

The last four are engineering. The first is hoping.

### Signal sources, ranked by value

1. **Escalations with reasons** (day 12) — the agent telling you where its boundary is. Highest signal, structured, free.
2. **Human corrections** — a staff member fixed the agent's work. Gold: you have the wrong answer *and* the right one.
3. **Repeat contacts** — the member came back. Means "resolved" was wrong.
4. **Explicit feedback** — thumbs. Low volume, biased toward the annoyed.
5. **Eval failures** — you already know about these.
6. **Trace anomalies** — long conversations, loops, high cost. Finds problems nobody reported.

Sources 2 and 3 are the ones teams neglect and are the most valuable, because they identify *silent* failures — the ones where the agent thought it succeeded.

### Triage: clustering, not case-by-case

Ten escalations for the same root cause is one problem, not ten. Cluster by escalation reason, tools involved, stage, and topic. Then prioritise:

```
priority = (frequency × impact) / effort
```

with impact weighted heavily for safety and trust issues, regardless of frequency. A rare data-disclosure bug outranks a common tone complaint.

Publish the top 5 weekly. That list is the roadmap.

### Verification discipline

Non-negotiable, in order:

1. Reproduce the failure as an eval case, and **watch it fail**
2. Establish the baseline on the full suite
3. Make the smallest change at the right layer
4. Re-run — the case now passes
5. **Re-run everything else** — nothing regressed
6. The new case stays in the suite **permanently**

Step 5 is where prompt fixes get caught. A prompt edit that fixes one thing routinely breaks three others; without the full-suite re-run you ship a net regression that feels like progress.

Step 6 is the ratchet. It is why the system gets monotonically better rather than oscillating.

### Prompt versioning

Prompts are code. Version them, review them, and record which version produced which trace (day 13). "It got worse last week" is only answerable if you can diff.

Keep a changelog with the *evidence*:

```
## v1.6.0 — 2026-07-22
- Added explicit fee-tool requirement (see policy no-unverified-prices)
  Fixes: fees-2026-07-19 cluster (14 escalations/week)
  Eval:  task_success 0.94 → 0.96 · cost unchanged · 0 regressions
```

### What automation can and cannot do

**Can:** cluster failures, propose prompt variants and A/B them against evals, mine traces for candidate golden-set cases, detect metric drift and open a ticket.

**Cannot, and should not:** auto-deploy prompt changes to production without human review; change policies; decide which layer to fix in.

**Never let an automated loop modify its own guardrails.** The day-17 principle again: the safety baseline is not in the loop.

### Model upgrades

The change you didn't make. Treat every model version as a release: run the full suite against both, compare per-category, shadow-run on production traffic, stage the rollout, keep the old version routable for rollback. Expect subtle behavioural differences in exactly the places you relied on prompt instructions rather than code enforcement — which is, itself, a good audit of where your enforcement is weak.

---

## Exercise

**1. Build the feedback store.** Every signal source above, normalised into one schema with a link back to the trace.

**2. Generate realistic failure signal.** Run 50 varied conversations against the golf club agent, including adversarial and edge cases. Capture everything.

**3. Build the clustering tool.** Group failures by root cause. Manual grouping is fine to start; then try LLM-assisted clustering and compare against your manual grouping — the disagreements are interesting.

**4. Build the triage report:** clusters ranked by (frequency × impact) ÷ effort, with example traces.

**5. Do the layer diagnosis for your top 5 clusters.** For each, write down the prompt fix and the structural fix, and choose. **Justify each choice in writing** — this is the exercise.

**6. Fix all five, following the six-step verification discipline exactly.** Record the eval numbers at each step.

**7. Establish prompt versioning** with a changelog including evidence.

**8. Build automated case mining:** find traces that would make good golden-set cases (escalated, long, expensive, low-confidence) and propose them for human review. Do not auto-add.

**9. Run a model comparison.** Two model versions or tiers, full suite, per-category comparison. Include cost and latency. Write the recommendation.

**10. Write `docs/architecture/improvement-loop.md`** — the loop, the layer table with your own worked examples, and the verification discipline.

**11. Measure the loop.** How long from signal to verified deployed fix? That cycle time is the health metric for the whole system.

---

## Deliverable

- [ ] Feedback store covering all six signal sources
- [ ] 50 conversations of real signal captured
- [ ] Clustering, manual and LLM-assisted, compared
- [ ] Triage report with prioritised clusters
- [ ] **Layer diagnosis for 5 clusters, with written justification**
- [ ] 5 fixes with full before/after eval evidence and permanent regression cases
- [ ] Prompt versioning + evidence-bearing changelog
- [ ] Case mining with human review
- [ ] Model comparison with a recommendation
- [ ] `docs/architecture/improvement-loop.md`
- [ ] `journal/day-19.md` — including cycle time

---

## Reflection

1. For your five clusters: how many did you initially want to fix in the prompt? How many should have been? What does that gap tell you?
2. Did any fix cause a regression elsewhere? Would you have shipped it without step 5?
3. Which signal source was most valuable? Which did you expect to be, and why were you wrong?
4. What is your cycle time from signal to deployed fix? What is the bottleneck?
5. What would you never automate in this loop, and why?

---

## Interview Question

> "Your agent is live. How do you make it better over time?"

The differentiator is layer diagnosis. Anyone can say "collect feedback and iterate". A strong answer names the seven layers, states that prompt fixes are the fragile default people reach for, and gives the heuristic of pushing fixes down the table into tools, policy, knowledge, and workflow where they are testable and permanent. Then the verification discipline: reproduce as a failing eval case first, baseline, minimal fix, re-run the *full* suite, keep the case forever. Plus: escalation reasons and human corrections as the richest signal; clustering rather than case-by-case; prompt versioning stamped into traces; and treating a model upgrade as a release that goes through the same gates. Best answers also state what they would refuse to automate.

---

**Next:** [Day 20 — Production deployment](day-20.md)
