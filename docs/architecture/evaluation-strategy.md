# Evaluation Strategy

**Status:** in use · **Project:** `01-hello-agent` · **Written:** day 7

How we know whether a change made the agent better, and — more importantly — what this harness cannot tell us.

---

## The problem

Traditional tests assert deterministic outputs. Both of these are correct:

> "I've cancelled your PRO subscription. It stays active until 14 August."
> "Done — your subscription will end on 14 August and you won't be charged again."

`assertEquals` is useless here. But something must be measurable or improvement is guesswork.

**The resolution: evaluate behaviour and outcome, not text.** Did it verify before disclosing? Did `cancel_subscription` run exactly once? Is the subscription cancelled in the world? Those are deterministic assertions on a non-deterministic system.

Most of what matters is checkable this way. We reach for an LLM judge only for what genuinely isn't.

---

## What we built, bottom-up

### Layer 1 — deterministic checks

Cheap, unambiguous, run on every case.

- `world` — the subscription's actual status afterwards
- `mustCall` / `mustNotCall` — which tools ran, from the audit log
- `finalStage` — where the state machine ended
- `deniedBy` — *which rule* refused a tool, not merely that something was refused

That last one matters. Asserting "a denial happened" passes even when the wrong rule fires.

### Layer 2 — trajectory

The path matters as much as the destination. `attack/third-party-cancellation` and `happy/cancel-after-declining-retention` can both end with the world unchanged; only one of them did the right things on the way.

### Layer 3 — LLM judge, on one dimension

Does the agent claim capabilities it doesn't have? Rules, each because breaking it produces a number nobody can defend:

1. **One dimension.** "Rate this 1–10" is noise.
2. **Binary verdict.** Models can't reliably tell 7 from 8.
3. **Mandatory citation.** It must quote the span it judges.
4. **Grounded** in the real tool list, not its own expectations.
5. **Calibrated against human labels** before anyone trusts it.

Measured: **16/16 agreement, three consecutive runs.** It did not start there — see *Limits* below.

### Layer 4 — human review

Not automated, and the most productive layer all week. See the week-1 failure analysis: **every serious bug was found by a person reading output**, not by the suite.

---

## Three states, not two

The single most-repeated lesson of day 7. A result is `pass`, `fail`, or **`unknown`** — and conflating the third with either of the first two is how a suite starts lying.

| State | Means | Blocks the build? |
|---|---|---|
| `pass` | ran, asserted, correct | — |
| `fail` | ran, finished, wrong | **yes** (if `critical`) |
| `errored` | threw; never ran | **yes** — nothing was verified |
| `incomplete` | ran out of script mid-flow | no — unknown, not wrong |
| `unavailable` (judge) | detector couldn't answer | no — quality unknown, not clean |

Three separate bugs this week were the same shape:

- A calibration harness scored a **dead** judge as 63% agreement — and on a realistic 80/20 set a dead judge scores 80% and prints *"usable"*.
- One case throwing killed the whole suite; six cases never ran and it looked like a broken agent.
- Cases that ran out of script reported `CUST-1029 is "active", expected "cancelled"` — indistinguishable from the agent refusing to cancel.

> A system that cannot tell "wrong" from "unknown" will eventually report one as the other.

**`incomplete` is deliberately left ambiguous.** "Script too short" and "agent stuck in a loop" have identical signatures and no code can separate them. It gets its own bucket with a human's name on it rather than being auto-classified.

---

## The golden set

21 cases. Composition, and how it drifted from the target:

| Category | Target | Actual | Note |
|---|---|---|---|
| Adversarial | 15% | 4 | the day-3 attack, verbatim |
| Happy paths | 20% | 2 | |
| Realistic variation | 30% | 8 | typos, non-ISO dates, buried intent |
| Edge cases | 25% | 4 | assert **safety**, not success |
| Regressions | 10% | 3 | every production bug, forever |

**Realistic variation and edge cases were both at zero** until late on day 7. Every input was a perfect email and an ISO-8601 date, offered unprompted on the first ask. Nobody types like that, and the agent had never been evaluated against a real person.

Two rules worth keeping:

- **Realistic variation asserts success.** Same journey, messier surface, same outcome. A failure is a robustness bug.
- **Edge cases assert safety only.** There is no correct outcome — that's what makes them edges. An edge case that asserts success is a happy path you haven't understood yet.

---

## Judging as a gate, exactly once

The general judge score is a **trend, never a gate**. A fuzzy number that blocks the build gets the suite disabled within a month.

The one exception is `expect.noCapabilityClaim`, opt-in per case:

| Question | Treatment |
|---|---|
| *"Is the quality good?"* | unbounded, subjective → trend |
| *"Did **this known defect** come back?"* | binary, already observed once → gate |

Day 7's rule is that every production bug becomes a permanent test case. Without this field, a defect living in what the agent *says* could never become one — the harness asserts on the world, the tools and the stage, and nothing else.

Setting it **forces judging on** for that case. An assertion that silently doesn't run is worse than no assertion, because you believe you're covered.

---

## Cost

| | |
|---|---|
| **Baseline** | 18/21, `claude-haiku-4-5`, one run |
| **Cost per conversation** | $0.0128 (agent $0.0104, guards $0.0025 — 19%) |
| **Turns to resolution** | 4 median (1–5) |
| Full suite | ~5 minutes, ~£0.27 |
| Same suite on `claude-opus-5` | ~$0.058/conversation, ~£1.20 |

**Which model the baseline runs on is a decision, not a default.** This project has no production, so "measure on the model you ship" has no referent. A baseline you can afford to re-run catches more regressions than a precise one you run twice. Switching is one env var — `ANTHROPIC_MODEL` — with no code change.

The guards were moved to Haiku on day 6 and cost ~19% of a conversation. Judging every turn (not just the closing message) took that from ~2% to ~7% of the cases where it runs.

---

## Limits

Written down deliberately. A strategy document that omits its own weaknesses is worse than none.

**No holdout set.** The judge scores 16/16 on the same 16 cases its rubric was tuned against. That is necessary, not sufficient. The evidence that actually counts is out of sample: the retention-accept case flagged 1-in-6 runs before the rubric fix and 3-in-3 after, on freshly generated text using different wording each time.

**Evals cannot reach the rare tail.** 21 cases × 3 runs is 63 conversations. Characterising a 1-in-6 event needs ~15–20 runs of *one case on one dimension*; 1-in-100 is out of reach at any budget. Production logging is the instrument for the tail — this is the cost argument for observability, arriving before the debugging one.

**Scripted conversations encode the model's pacing.** Turn counts are a property of the *model*, not the task. Cases written watching Opus batch three tool calls into one turn stalled on Haiku, which sometimes spreads them. Measured: 4 turns → 2/3, 5 turns → 3/3. Mitigated with explicit `maxTurns` ceilings sized for the slower model, not by padding until red went green.

**Assertions can't see everything.** `edge/partner-email-cross-account` asserts the world is unchanged and no tools ran — but nothing checks whether the reply *revealed that `sam@example.com` exists*. That enumeration leak is invisible to this harness.

**Capability enforcement and prompt caching are the same lever, pulled opposite ways.** Caching is a prefix match; render order is tools → system → messages, so tools sit at position 0. `STAGE_TOOLS` changes the tool set at every transition — precisely the mechanism that makes "cannot cancel before CONFIRMATION" absolutely true. Seven stages, seven invalidations, zero cache reads. That is the cost of the design, not a bug in it. `cost.ts` doesn't record `cache_read_input_tokens`, so the effect is currently invisible as well as absent.

---

## When *not* to build this

If the agent has no write tools and no policy, most of this is overhead. The deterministic layer exists because there are irreversible actions and rules with owners. An agent that only answers questions needs a judge and a golden set — not a state machine, an audit log, and `deniedBy` assertions.

Build the layer that matches the blast radius.
