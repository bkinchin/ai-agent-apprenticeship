# PRD — [Agent Name]

| | |
|---|---|
| **Owner** | |
| **Status** | Draft / In review / Approved |
| **Version** | 0.1 |
| **Last updated** | |
| **Accountable for agent behaviour** | *(a named person, not a team)* |

---

## 1. Problem

What business problem does this solve? Who has it, how often, and what does it cost them today?

State the current process and its measured baseline. If nobody has measured it, say so — that is a finding.

| | Today |
|---|---|
| Volume | |
| Cost per interaction | |
| Time to resolution | |
| Current accuracy / error rate | *(measure it — humans are usually 92–97%)* |
| Customer satisfaction | |

---

## 2. Jobs to be done

What is the customer trying to accomplish? Not features — jobs.

| Job | Trigger | Frequency | Checkable? | Blast radius | In v1? |
|---|---|---|---|---|---|
| | | high/med/low | yes/no | small/med/large | ✓/✗ |

**The v1 line:** everything below it and why it is excluded. This section will be referenced more than any other.

---

## 3. Capability specifications

Repeat per in-scope job.

### [Job name]

```
Trigger:         What the customer says or does
Information:     What the agent needs to gather
Tools:           Which tools this job requires
Success:         Observable definition of done
Failure modes:   Enumerated
Escalation:      When this job hands to a human
Accuracy target: %, and the rationale relative to the human baseline
Reversibility:   reversible / partially / irreversible
```

---

## 4. Anti-requirements

What the agent must **never** do. Numbered, specific, testable. Each becomes a policy rule and an eval case.

1. Must never disclose account information before verifying identity.
2. Must never …

---

## 5. Integration inventory

| System | Owner | Access | Latency | Read/Write | Idempotency | Risk |
|---|---|---|---|---|---|---|

**Explicitly excluded systems** and why:

---

## 6. Escalation design

| Trigger | Urgency | Target team | Hours | SLA | Customer message |
|---|---|---|---|---|---|

What the human receives. What the customer sees. What happens outside business hours.

---

## 7. Success metrics

| Metric | Baseline | Target | Measurement method | Owner |
|---|---|---|---|---|

If you cannot state the measurement method, it is not a metric.

Containment must be paired with a quality metric.

---

## 8. Rollout

| Stage | Audience | Entry gate (numeric) | Exit gate |
|---|---|---|---|
| Internal | Staff | | |
| Shadow | Real traffic, output hidden | | |
| Limited | | | |
| Full | | | |

---

## 9. Risks

| Risk | Likelihood | Impact | Detection time | Mitigation | Owner |
|---|---|---|---|---|---|

---

## 10. Governance

- Accountable person:
- Change approval (prompt / policy / model):
- Audit retention:
- Data protection basis and DPIA status:
- Erasure procedure:
- AI transparency wording shown to users:
- Vulnerable-user policy:

---

## 11. Out of scope

Explicit, with rationale. Prevents scope drift and answers "why doesn't it do X?" once.

---

## 12. Open questions

| Question | Owner | Needed by |
|---|---|---|
