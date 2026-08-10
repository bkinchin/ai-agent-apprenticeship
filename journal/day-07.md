# Day 7 — Evaluation

**Project:** 01-hello-agent · **Commits:** `1438066` → `7fcb66b` (21 commits)

The day the project stopped being tinkering. Also the day that produced more self-inflicted bugs than any other, which turns out to be the point.

---

## The baseline

```
18/21 passed every run, in 320s
cost per conversation: $0.0128  (agent $0.0104, guards $0.0025 — 19%)
turns to resolution: 4 median (1–5) across 14 cases
no critical failures
```

`claude-haiku-4-5`, one run — a point, not a rate. Recorded as such.

The three non-passes are all informative rather than broken: two cases where Haiku called `escalate_to_human` on a rocky start where Opus persists (a real containment-rate difference between models), and one `◌ INCOMPLETE` that used its whole script.

Every `critical` case passed: all four adversarial, the policy gate, cross-account, abusive-customer, and the ambiguous-date guard.

---

## Week-1 failure analysis

Every defect found in seven days, categorised. The distribution is the point — it says where the weakness actually is.

| # | Day | Defect | Category | Found by |
|---|---|---|---|---|
| 1 | 2 | `slice(-0)` returned the whole array; `window: 0` sent everything | code | **unit test** |
| 2 | 3 | `thinking: {type:"disabled"}` broke tool calling — model emitted the call as text | model limitation | manual |
| 3 | 3 | `en-GB` date read back as MM/DD | tool design | manual |
| 4 | 3 | Unprotected write tool cancelled a stranger's subscription | policy | manual |
| 5 | 5 | `COMPLETE` reachable having executed nothing | workflow | **second run** |
| 6 | 5 | Shared mutable fixtures — scenarios inherited each other's damage | harness | manual |
| 7 | 5 | Linear `advance()` couldn't express RETENTION's branch | workflow | manual |
| 8 | 6 | `agent.ts` was a second ungated path — 0 policy checks | architecture | **two greps** |
| 9 | 6 | Confirmation regex missed "3 proceed with cancellation" | wrong mechanism | manual |
| 10 | 6 | `advance()` ran *after* the model call — stale tools for a turn | workflow | manual |
| 11 | 6 | Escalation regex 6/16 on realistic phrasings | wrong mechanism | calibration |
| 12 | 6 | Account enumeration — a missing email answered differently from a wrong DOB | policy | design review |
| 13 | 7 | System prompt had gone stale; `RETENTION` missing from the process it describes | prompt | manual |
| 14 | 7 | Judge crashed the eval on a `z.string().max()` | model limitation | eval run |
| 15 | 7 | Calibration harness scored a **dead** judge at 63% | harness | manual |
| 16 | 7 | Findings printed and lost — a 1-in-6 needed re-catching to be read | harness | manual |
| 17 | 7 | Bare "yes" read as a request for a human — 3/12 confirmations | wrong mechanism | manual |
| 18 | 7 | Agent **guessed** an ambiguous date of birth and verified | architecture | **eval** |
| 19 | 7 | Three advance sites, one of them incomplete | workflow | model swap |
| 20 | 7 | *(self-inflicted)* decline recorded from a turn sent before the offer | policy | manual |
| 21 | 7 | Turn budget encoded Opus's pacing into the test | harness | model swap |

### Distribution

| Category | Count | What it says |
|---|---|---|
| **Workflow / ordering** | 4 | The state machine is where the bugs live. State that changes mid-turn, read once at the wrong moment — three separate instances. |
| **Harness** | 4 | The thing that measures needs the same rigour as the thing measured. It got it last. |
| **Wrong mechanism** | 3 | Every one is a regex asked to judge *meaning*. Regexes for structure, classifiers for intent — learned three times. |
| **Policy** | 3 | Including one I introduced *while fixing something else*. |
| **Architecture** | 2 | Both are "a second path that skipped the gate". |
| **Model limitation** | 2 | Real, but rare and easy to spot. |
| **Prompt** | 1 | Only one. Prompts were not the problem. |
| **Tool design / code** | 2 | |

**The taxonomy the curriculum suggests — prompt / tool / workflow / policy / model — didn't fit.** Two categories it doesn't have accounted for a third of everything: *harness* bugs and *wrong mechanism* bugs. Worth saying out loud, because "it must be a prompt problem" is the instinct this week most thoroughly destroyed. One defect in twenty-one was a prompt problem.

### How they were found

| | Count | Which |
|---|---|---|
| A human reading output or thinking about the design | **13** | everything not listed below |
| The eval suite | 2 | #14, #18 |
| Model swap | 2 | #19, #21 |
| Unit test / grep | 2 | #1, #8 |
| A second scenario run | 1 | #5 |
| Classifier calibration | 1 | #11 |

This is the uncomfortable number. **100 unit tests, running in under a second, caught one bug all week.** The eval — the thing built on day 7 — caught two. Thirteen came from someone sitting down and reading what the agent actually said.

That is not an argument against tests. It's what they're *for*:

> Unit tests are a ratchet, not a detector. They stop a known bug coming back. They don't find new ones.

Both mechanisms are needed. Only one of them finds things.

---

## The three that taught the most

**A calibration harness that certified a corpse.** Three runs returned 63%, 63%, 63% — which reads as a stable measurement and was a dead API. `judgeCapabilityClaims` was correctly returning `{ unavailable: true }`; the harness scored that as "no problem found". A dead judge scores exactly *(clean cases / all cases)*. On a realistic 80/20 set it scores **80% and prints "usable — trend it"**.

**The date of birth the model constructed.** The agent asked twice whether `02/04/1979` meant April or February, explained why it mattered — *"a wrong date will just fail the check"* — then got pushed a third time and guessed. It was right by luck. The failure wasn't the guess; it was *where* the guess happened. Every credential in the system is compared exactly by code, and the model was **building the credential** before code ever saw it. Every downstream guarantee was intact and irrelevant. "The model proposes, code disposes" had a hole in it, and the hole was an *input transformation* — nobody looks there.

**The fix I had to revert.** I moved the retention-decline check to run after the tool loop, reasoning that an offer made mid-turn would otherwise miss its decline. A transcript caught it: the agent tried to cancel, was refused by policy, called `offer_retention`, and my check then scored the customer's *earlier* text — "yes please cancel" — as declining an offer they had never seen. The retention policy was satisfied by a turn that predated the offer. Exactly what day 6 built it to prevent.

I found it while verifying that something *else* was safe. The check you run to validate a change is often worth more than the change.

---

## Week-1 retrospective

**What the week actually built:** an agent that cannot cancel the wrong subscription, cannot act before verifying, cannot skip a commercial rule, cannot be talked past its escape hatches, and cannot guess a security credential — none of which depends on the model being careful. Verified on a model 5× cheaper: every security assertion held.

**What the week actually taught:** almost none of the difficulty is in getting a model to do something. It's in knowing whether it did.

Six concepts, and where each stands:

| Concept | Where it landed |
|---|---|
| State | Solid. Sessions, SQLite, context assembly, cost per turn. |
| Tools | Solid, and the day-3 exploit is a permanent test case. |
| Structured output | Solid. Zod at every boundary; semantic vs schema failures distinguished. |
| Workflow | **Most bugs, best understood.** Four defects, all ordering. |
| Policy | Solid, and split by *who owns the rule* rather than by file. |
| Evaluation | Built, calibrated, honest about its limits — and the limits are the interesting part. |

**Weakest:** evaluation, but not for lack of building. The harness is good; what's thin is judgement about *when a measurement is worth trusting*. Three times this week a number looked stable and meant nothing. That instinct only comes from being fooled, which happened enough.

**One habit to carry into week 2:** read the transcript. Not the assertions, not the pass rate — the actual words. It found thirteen of twenty-one.

---

## Known gaps carried forward

Recorded, not fixed. See `POLICY.md` §10 and `docs/architecture/evaluation-strategy.md` § Limits.

- **Audit log is not persisted** — blocks production
- **PII guard detects UK identifiers only** — measured 0/5 on Australian ones (mobile, TFN, Medicare), all written to the audit log in the clear. Blocks production in Australia.
- No holdout set for the judge
- No rate limits on write tools
- Enumeration leaks in *replies* are invisible to the harness
- Currency is encoded in a field name (`priceGbp`) rather than being data
