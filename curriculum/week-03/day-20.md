# Day 20 — Production Deployment

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can take an agent from a working local system to something operable in production — deployed, monitored, rollback-ready, and governed.

---

## Concepts

### What changes in production

| | Local | Production |
|---|---|---|
| Users | You | Real people with real problems |
| Failure | Restart it | Someone is affected |
| Data | Fixtures | Personal data, regulated |
| Cost | Pennies | A line item someone owns |
| Change | Edit and run | Reviewed, staged, reversible |
| When it breaks | You notice | You get paged — or you don't, which is worse |

### Deployment architecture

Nothing exotic. An agent is a stateful HTTP service with an expensive dependency.

```
   channels (web · phone · WhatsApp · email)
              │
              ▼
   ┌────────────────────┐
   │   API gateway      │  authn · rate limit · request ID
   └─────────┬──────────┘
             ▼
   ┌────────────────────┐   ┌──────────────────┐
   │   Agent service    │──▶│  Model provider  │
   │   (stateless)      │   │  + fallback      │
   └─────────┬──────────┘   └──────────────────┘
             ▼
   ┌────────────────────┐   ┌──────────────────┐
   │  Session / memory  │   │  Business systems│
   │  store             │   │  (tools)         │
   └────────────────────┘   └──────────────────┘
             │
             ▼
   ┌────────────────────┐
   │ Traces · metrics · │
   │ alerts · evals     │
   └────────────────────┘
```

**Keep the service stateless; keep state in the store.** Then you can scale horizontally, restart freely, and deploy without dropping conversations mid-flight.

### Configuration and secrets

Everything that varies by environment is configuration: model name and version, prompt version, policy version, feature flags, limits, escalation targets.

**Pin the model version explicitly.** Using a floating alias means your production behaviour changes when the provider ships an update, on their schedule, with no deploy and no notice. This is the most common self-inflicted production surprise in the field.

Secrets in a secret manager, rotated, never in the repo, never in traces.

### The controls you must have before launch

Non-negotiable, and each one should be a single action someone on call can take:

1. **Kill switch** — disable the agent entirely, route everything to humans. Test it. Time it.
2. **Per-tool disable** — turn off `confirm_booking` without taking the whole agent down.
3. **Rate limits** — per user, per tenant, global. Cost and abuse protection.
4. **Cost circuit breaker** — halt when spend exceeds a threshold. An agent in a loop can spend thousands overnight.
5. **Rollback** — previous version, one command, under five minutes. Including prompt and policy versions, not just code.

Rehearse the kill switch and the rollback before launch. An untested control does not exist.

### Rollout strategy

```
internal staff  →  shadow  →  5% read-only  →  25%  →  100% read
                                                  →  assisted writes
                                                  →  autonomous writes
```

Gates between stages, defined in advance: minimum volume, minimum task success, zero policy violations, escalation rate within range, cost within budget, no unresolved critical incidents.

**Write the gates down before you start.** Deciding "is this good enough to proceed?" in the moment, under commercial pressure, produces the wrong answer.

### On-call and incident response

Agents fail differently from conventional services. Severity levels worth defining:

| Sev | Example | Response |
|---|---|---|
| 1 | Unauthorised actions; data leakage | Kill switch now, then investigate |
| 2 | Policy violations; systematic wrong answers | Disable affected tool, page |
| 3 | Elevated escalation; degraded quality | Investigate in hours |
| 4 | Cost or latency drift | Next working day |

Note that Sev 1 response is **stop first, diagnose second**. With a system that takes actions against systems of record, every minute of investigation is more wrong actions.

Runbooks for the common incidents: model provider outage (fallback or degrade), cost spike, tool integration down, prompt regression, escalation queue backing up.

### Governance

The part that gets skipped and then blocks the launch.

- **Accountability** — a named human owns the agent's behaviour. Not a team; a person.
- **Change control** — who approves prompt, policy, and model changes? (Policy changes usually need a business owner, not just an engineer.)
- **Audit** — every action, retained per your policy, retrievable on request
- **Data protection** — DPIA if you handle personal data; a lawful basis; a retention schedule; a working erasure path
- **Transparency** — users must know they are talking to an AI, and how to reach a human. This is increasingly a legal requirement, and it is the right thing regardless.
- **Model provider terms** — data retention, training use, sub-processors, region. Check before launch, not after.
- **Vulnerable users** — a defined policy (day 12), enforced

Bring these to the table early. An engineer who raises governance before legal does is trusted with more.

### Scaling and cost

Model calls dominate cost and latency. The levers, in order of impact:

1. **Fewer turns** — better tools and clearer prompts beat any infrastructure optimisation
2. **Smaller context** — day 2's structured task state, not history replay
3. **Cheaper model for cheap tasks** — classification and routing rarely need your best model
4. **Caching** — prompt caching for stable prefixes; response caching for common questions
5. **Streaming** — doesn't reduce cost, transforms perceived latency

Rate limits from the provider are a real capacity constraint. Know yours, and have a queueing and back-pressure story.

---

## Exercise

**1. Containerise and deploy** the golf club agent somewhere real — a small VM or a platform service. Stateless service, external state store. It must be reachable over the internet with authentication.

**2. Externalise all configuration** including pinned model version, prompt version, and policy version. Prove that changing a config value changes behaviour without a code deploy.

**3. Build the five controls.** Kill switch, per-tool disable, rate limits, cost circuit breaker, rollback. **Test each one and record how long it took to execute.**

**4. Build the health endpoint** — model provider reachable, tool APIs reachable, store reachable, recent error rate, current version set.

**5. Wire up production monitoring** from day 13: dashboard and alerts, with the alerts actually delivering somewhere.

**6. Write the rollout plan** with stages and explicit numeric gates.

**7. Write the runbooks** — five incidents minimum, each with symptom, diagnosis steps, mitigation, and escalation path.

**8. Run a game day.** Have Claude inject a production incident (provider outage, cost spike, policy regression, tool failure, a member reporting a wrong answer). **Respond using only your dashboards and runbooks.** Time yourself: detection, diagnosis, mitigation. Write up what was missing.

**9. Complete the governance pack:** named owner, change control process, data protection assessment, retention schedule, erasure procedure, AI transparency wording, vulnerable-user policy.

**10. Do the cost model.** Cost per conversation and per resolution at 100, 10,000, and 1,000,000 conversations a month. Compare with the human cost. **Where is the break-even, and what happens to the business case if the model price halves — or doubles?**

**11. Load test.** 50 concurrent conversations. What breaks first? Usually provider rate limits, not your code.

---

## Deliverable

- [ ] Deployed, authenticated, reachable agent
- [ ] Externalised config with pinned model version
- [ ] Five controls, **each tested with a recorded execution time**
- [ ] Health endpoint
- [ ] Live monitoring and delivered alerts
- [ ] Rollout plan with numeric gates
- [ ] Five runbooks
- [ ] Game day write-up with detection/diagnosis/mitigation times
- [ ] Governance pack
- [ ] Cost model at three scales with break-even analysis
- [ ] Load test results
- [ ] `journal/day-20.md`

---

## Reflection

1. How long did the kill switch take to execute? Would that be fast enough during a Sev 1?
2. What broke first under load? Was it what you expected?
3. What was missing during the game day? Add it now.
4. Your cost model at a million conversations — is the business case still there? What is the sensitivity to model price?
5. Which governance item would have blocked a launch if you'd left it to the end?

---

## Interview Question

> "Take me through deploying a customer-facing agent to production. What are you most worried about?"

Strong answers treat it as ordinary service operations with agent-specific hazards layered on: stateless service, external state, pinned model version — and the observation that a floating model alias means your behaviour changes without a deploy. The controls: kill switch, per-tool disable, cost circuit breaker, rollback that covers prompt and policy versions, all rehearsed. Staged rollout with numeric gates written in advance. Sev 1 means stop first, diagnose second, because an agent that acts wrongly keeps acting. Governance raised early — named owner, audit trail, erasure path, AI transparency, vulnerable-user policy. And on "most worried about": the best answers name a *silent* failure — the agent confidently doing the wrong thing at low volume, undetected for weeks — rather than a loud outage, because loud failures are easy.

---

**Next:** [Day 21 — Final demo and interview preparation](day-21.md)
