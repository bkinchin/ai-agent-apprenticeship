# Evaluation Plan — [Agent Name]

| | |
|---|---|
| **Version** | |
| **Owner** | |
| **Baseline established** | |

---

## 1. What "working" means

Define success before measuring it. Per job, not in aggregate.

| Job | Definition of success | Target | Human baseline |
|---|---|---|---|

---

## 2. Metrics

| Metric | Definition | Target | Type | Blocks release? |
|---|---|---|---|---|
| Task success | | | quality | no — threshold |
| **Policy violations** | | **0** | safety | **yes** |
| Escalation rate | | range | quality | no |
| Abstention accuracy | | | quality | no |
| Validation failure rate | | < 1% | leading | no |
| Turns to resolution | median | | efficiency | no |
| Cost per conversation | | | cost | warn |
| Cost per resolution | | | cost | warn |
| p95 latency | | | reliability | warn |

Containment, if used, must be paired with a quality metric.

---

## 3. Golden set

| Category | Target share | Actual count | Source |
|---|---|---|---|
| Happy paths | 20% | | |
| Realistic variation | 30% | | real transcripts |
| Edge cases | 25% | | |
| Adversarial | 15% | | red teaming |
| Regressions | 10% | | production incidents |

**Holdout:** 20% never used during tuning.

**Refresh cadence:** monthly from production.

**Rule:** every production bug becomes a permanent case.

---

## 4. Assertion families

| Family | What it checks | Deterministic? |
|---|---|---|
| Side effects | What changed in the world | yes |
| Trajectory | Tools called, order, stages visited | yes |
| Policy | Violations, rules triggered | yes |
| Schema | Output validity | yes |
| Response | Tone, clarity, content | no — LLM judge |
| Cost / latency | Within bounds | yes |

Prefer deterministic assertions. Reach for the judge only for what genuinely isn't checkable.

---

## 5. LLM judges

Per judge:

| | |
|---|---|
| **Dimension** | *(one only)* |
| **Scale** | binary or 3-point |
| **Rubric** | anchored examples per level |
| **Citation required** | yes — must quote the span judged |
| **Human agreement** | *(measured on ≥ 15 cases — must be ≥ 80%)* |
| **Recalibrated** | *(date)* |

An uncalibrated judge is not evidence.

---

## 6. Determinism and repeats

- Temperature: 0
- Model version: pinned
- Fixtures: seeded, reset per case
- Clock: frozen
- Runs per case: 3
- Critical cases reported at **worst** result, never averaged
- Flakiness reported, not hidden

---

## 7. Tiers

| Tier | Cases | Trigger | Budget (time) | Budget (£) |
|---|---|---|---|---|
| Smoke | critical only | every commit | | |
| Standard | | every PR | | |
| Full | all × 3 | nightly | | |
| Adversarial | red-team set | weekly + pre-release | | |

---

## 8. Release gates

| Gate | Condition |
|---|---|
| Policy violations | = 0 — **hard block** |
| Critical case failures | = 0 — **hard block** |
| Task success | ≥ baseline − 1% |
| Cost per conversation | ≤ baseline × 1.15 |
| p95 latency | ≤ baseline × 1.2 |

---

## 9. Baseline

| Metric | Value | Date | Version |
|---|---|---|---|

Every future change is measured against this.

---

## 10. Known gaps

What this evaluation does **not** cover, and the risk that leaves.
