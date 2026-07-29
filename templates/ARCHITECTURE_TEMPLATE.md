# Architecture — [Agent / System Name]

| | |
|---|---|
| **Author** | |
| **Status** | Draft / Reviewed / Accepted |
| **Version** | |
| **Related PRD** | |

---

## 1. Summary

Three sentences. What this is, the shape of the solution, and the single most important design decision.

---

## 2. Context

What exists around this system. Upstream channels, downstream systems of record, who operates it.

```
[ diagram ]
```

---

## 3. Agent architecture

Which pattern, and why. (Chain / Router / Tool loop / State machine / Plan-execute / Reflection / Multi-agent — see day 15.)

**Pattern chosen:**

**Why this pattern:**

**What was rejected and why:**

### Autonomy level

Where does the model decide, and where does code decide?

| Decision | Owner | Rationale |
|---|---|---|

---

## 4. Components

| Component | Responsibility | Key decision |
|---|---|---|
| Context assembler | | |
| Session store | | |
| Tool executor | | |
| Policy engine | | |
| Knowledge retrieval | | |
| Memory | | |
| Escalation | | |
| Tracing | | |

---

## 5. State model

| Kind | What | Where it lives | Lifetime | Owner |
|---|---|---|---|---|
| Conversation | | | | |
| Task | | | | |
| Business | | *system of record* | | |
| Memory | | | | |

**Confirm:** business state is never sourced from the model.

---

## 6. Workflow

The state machine, if there is one. Include unhappy paths, escape hatches, and the tool set available in each stage.

```
[ diagram ]
```

| Stage | Entry condition | Allowed tools | Exit condition |
|---|---|---|---|

---

## 7. Tool inventory

| Tool | Read/Write | System | Idempotent | Timeout | Policy gates | Failure handling |
|---|---|---|---|---|---|---|

---

## 8. Data flow

Trace a single request end to end. Include what is in the context window at each step.

---

## 9. Failure modes

| Failure | Likelihood | Detection | Response | Blast radius | Reversible |
|---|---|---|---|---|---|

---

## 10. Non-functional

| | Target | How measured |
|---|---|---|
| p50 / p95 latency | | |
| Cost per conversation | | |
| Cost per resolution | | |
| Throughput | | |
| Availability | | |

---

## 11. Security and privacy

Threat model summary. Prompt injection surfaces (including retrieved content and user free-text). Authorisation model. PII handling in traces. Retention and erasure.

---

## 12. Decisions and alternatives

| # | Decision | Alternatives considered | Rationale | Reversible? |
|---|---|---|---|---|

The most valuable section of this document in six months. Record what you rejected.

---

## 13. Known limitations

Honest list. What this design does badly, and under what conditions it should be revisited.

---

## 14. Open questions
