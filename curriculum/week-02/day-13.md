# Day 13 — Observability

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can reconstruct exactly what an agent did and why, from data alone — and you have alerts that fire before customers complain.

---

## Concepts

### Why this is harder than normal observability

A conventional service has deterministic logic: the same input gives the same path. An agent has a *reasoning trace* that varies run to run.

So when a member says "your bot told me the wrong green fee", you cannot re-run it and see. You need the original run recorded in enough detail to answer:

- What was in the context window? (All of it — this is the input to the decision.)
- Which tools were called, with what arguments, and what came back?
- Which knowledge chunks were retrieved?
- Which memories were injected?
- What did the policy engine decide, and under which policy version?
- Which model and prompt version?

Without this you are debugging by re-prompting and hoping, which is not engineering.

### The trace as the unit

One conversation = one trace. Spans nest inside it.

```
trace  session=s_8f2a  member=M-4471  duration=12.4s  cost=£0.031
│
├─ span  turn.1                                        1.9s
│  ├─ span  context.assemble        tokens=1,240
│  │        system=v12 · memories=3 · knowledge=0 · window=6
│  ├─ span  llm.call                1.6s  £0.004
│  │        model=<pinned>  in=1,240  out=87  finish=tool_calls
│  └─ span  tool.check_availability 0.3s
│           args={date:"2026-08-02",window:"morning"}
│           result=4 slots  · policy=allow
│
├─ span  turn.2                                        4.1s
│  ├─ span  policy.evaluate         rule=guest-limit  decision=DENY
│  │        policy_version=3
│  └─ span  llm.call                explains the denial
│
└─ span  escalation                 reason=policy  urgency=standard
```

You should be able to hand this to someone who wasn't there and have them explain the outcome. That is the bar.

### What to record on every span

- IDs: trace, span, parent, session, member (pseudonymised)
- Timing: start, duration
- Type and name
- Input and output — **the actual content**, not a summary
- Cost: tokens in/out, price
- Versions: model, prompt, policy, knowledge corpus
- Outcome: ok / error / denied

**Version stamping is the thing people forget and regret.** When quality drops on Tuesday you need to know what changed on Monday. Stamp every span with every version it depended on.

### The four metric families

| Family | Metrics | Alerts on |
|---|---|---|
| **Quality** | Task success, escalation rate by reason, abstention rate, validation failure rate | Degradation |
| **Behaviour** | Steps per conversation, tool call distribution, stage-drop-off, loop rate | Drift |
| **Cost** | Tokens/conversation, £/conversation, £/resolution | Runaway |
| **Reliability** | Tool error rate, p50/p95/p99 latency, timeout rate, circuit-breaker trips | Incidents |

### Leading vs lagging indicators

This distinction is where the value is.

**Lagging** (you already have a problem): complaints, task success drop, containment fall.

**Leading** (you have hours or days): 

- **Schema validation failure rate rising** — the model's output is drifting
- **Average steps per conversation rising** — it's struggling before it's failing
- **Tool error rate on one tool** — an integration is degrading
- **Escalation reason mix shifting** — something changed in the world or in your system
- **Retrieval returning fewer results** — corpus or query drift
- **Cost per conversation rising with flat volume** — always means something

Alert on the leading indicators. Report on the lagging ones. A team that only watches task success finds out from customers.

### Alerts worth having

```yaml
- name: policy_violation
  condition: count > 0            # any window
  severity: critical               # this should never happen
  
- name: escalation_rate_spike
  condition: rate > baseline * 1.5 for 30m
  severity: high

- name: validation_failure_rate
  condition: rate > 1% for 15m
  severity: high                   # leading indicator

- name: cost_per_conversation
  condition: > 2× 7-day median for 1h
  severity: high

- name: loop_detection
  condition: count > 5 in 1h
  severity: medium

- name: tool_error_rate
  condition: per-tool rate > 5% for 10m
  severity: high
```

Rule: **every alert must have a runbook entry.** An alert nobody knows how to action is noise, and noise trains people to ignore alerts.

### PII in traces

Traces contain everything the member said. That is personal data, and it is where privacy programmes typically fail.

- Redact on write, not on read — obvious identifiers (card numbers, emails, phone) masked at ingestion
- Pseudonymise member IDs; keep the mapping separately and access-controlled
- Retention limits, enforced — 30 days full, then aggregate
- Access controlled and audited
- Erasure requests must reach the trace store

### Cost attribution

Track cost per conversation, per job type, per outcome. Then compute **cost per resolution** — cost per conversation divided by the resolution rate. An agent that costs £0.03 per conversation but resolves 40% costs £0.075 per resolution. Compare that to the human cost of the same job. That single number is what a CFO asks for and what most teams cannot produce.

---

## Architecture

```
   Agent runtime
        │  emits spans (async, non-blocking, never fails the request)
        ▼
   ┌──────────────┐
   │  Collector   │  redact → enrich (versions) → buffer
   └──────┬───────┘
          ▼
   ┌──────────────┐        ┌───────────────┐
   │ Trace store  │───────▶│ Trace viewer  │  ← debugging
   │  (SQLite)    │        └───────────────┘
   └──────┬───────┘
          ▼
   ┌──────────────┐        ┌───────────────┐
   │  Aggregator  │───────▶│  Dashboard    │  ← trends
   └──────┬───────┘        └───────────────┘
          ▼
   ┌──────────────┐
   │   Alerting   │───────▶  runbook
   └──────────────┘
```

Emission must be **async and failure-tolerant**. Observability that can break the request is worse than none.

Use the OpenTelemetry data model even with a homemade backend — you will eventually move to a real one, and matching the model makes that a migration rather than a rewrite.

---

## Exercise

**1. Design the trace schema first.** Write it down before implementing. What does every span carry?

**2. Build the tracer.** Context propagation so any code can add a span without threading a parameter through everything. Async emission. Never throws.

**3. Instrument everything** in the golf club agent: turns, LLM calls, tool calls, retrieval, memory read/write, policy evaluations, escalations, context assembly.

**4. Record the full context window on every LLM call.** It's large. Store it anyway — this is the field you will actually use when debugging, and the one people most often omit to save space.

**5. Version-stamp every span** with model, prompt, policy, and corpus versions.

**6. Build the trace viewer.** CLI or a tiny HTML page. `view-trace <sessionId>` should render the tree with timings, costs, and expandable inputs/outputs.

**7. Redact PII at ingestion.** Card numbers, emails, phones. Test it with a conversation containing all three.

**8. Compute the four metric families** from the trace store.

**9. Implement the alerts above**, and **write a runbook entry for each** — symptom, likely cause, first three diagnostic steps, mitigation.

**10. Run a debugging exercise.** Have Claude introduce a subtle bug into your agent without telling you what it is — a wrong policy condition, a truncated retrieval, a bad enum. Then find it **using only the traces and metrics.** Time yourself. This is the day's real test.

**11. Compute cost per resolution** and compare it to a plausible human cost for the same job.

---

## Deliverable

- [ ] Documented trace schema
- [ ] Tracer with context propagation, async, non-throwing
- [ ] Full instrumentation including complete context windows
- [ ] Version stamping on every span
- [ ] Trace viewer
- [ ] PII redaction, tested
- [ ] Four metric families computed
- [ ] Six alerts, each with a runbook entry
- [ ] `docs/architecture/observability.md`
- [ ] `journal/day-13.md` — the debugging exercise, with your time-to-diagnosis

---

## Reflection

1. How long did the debugging exercise take? What data did you wish you had? Add it.
2. Which leading indicator would have caught your injected bug earliest?
3. What is your cost per resolution? How does it compare to a member of staff doing the same job? Is the business case real?
4. A member complains about a conversation from three weeks ago. Can you answer them? What's your retention policy, and does it conflict with your ability to investigate?
5. Which of your alerts would fire most often in reality? Is it actionable, or would it become noise?

---

## Interview Question

> "Your agent's quality has degraded over the last week. Nothing was deployed. How do you investigate?"

Strong answers start with data, not hypotheses: check whether the model version changed underneath you (it does), compare metrics week over week — validation failure rate, steps per conversation, tool errors, escalation reason mix — and segment by job type and by conversation length rather than looking only at the aggregate. Then: pull traces from failing conversations and read the actual context windows; check whether the knowledge corpus or a downstream API changed; run the golden set against both time periods. The key insight is that "nothing was deployed" is rarely true for an agent — the model, the data, the integrations, and the users all change without a deploy, and version stamping is what lets you tell which.

---

**Next:** [Day 14 — Production review](day-14.md)
