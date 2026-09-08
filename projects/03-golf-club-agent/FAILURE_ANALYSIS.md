# Failure Analysis — Golf Club Member Agent

**Written:** day 14 · **Scope:** every failure mode observed or reasoned about, days 8–14

> *"The value of this document is proportional to its discomfort."*

Every entry below **actually happened** unless marked *unobserved*. Frequency is from observation where there is any, and stated as unknown where there is not — a made-up frequency is worse than an absent one.

---

## The shape of the month

**Thirty-one defects were found. Twenty-six were found by a person using the agent. Two were found by a suite.**

That ratio is the single most important number in this document, and it does not improve with more suites — it improves with more use. Every suite in this project was written *after* a human found the thing it now guards.

---

## Root cause: POLICY — a rule that existed and was not enforced

**The most common category, and the most dangerous, because the rule being written down makes everyone believe it is applied.**

| Failure | Frequency | Detection | Mitigation |
|---|---|---|---|
| Competition window not enforced — the agent explained the tee sheet was shut and then booked into it | Every Saturday morning request | A member driving to a closed tee sheet | ✅ Closed slots filtered from availability; rules enforced inside the tool |
| `guests.max_per_booking: 2` enforced nowhere — 4 guests booked, $80 charged | Any request for 3+ guests | At the first tee | ✅ `checkBooking` |
| `min_notice_hours: 1` enforced nowhere | Any same-hour booking | Never | ✅ `checkBooking` |
| `max_days_ahead` **duplicated** — 42 in TypeScript and in the YAML | On any change to the club's rule | Never | ✅ Read from the rulebook |
| Live-booking and guest limits taken from the **supplier's** response | If the sheet is edited | Never | ✅ Reconciled; stricter wins; disagreement logged |
| 24-hour cancellation fee lived in a **tool description** | Any late cancellation | The member's account | ✅ Assisted mode |

> **The cause was one seam.** `booking-rules.yaml` was written on day 9 for the *knowledge* agent; the tools were written on day 10 against the *API*. Each was correct about its own half and nobody asked whether the supplier knew the club's rules. **Three of six rules were enforced nowhere.**

---

## Root cause: PROMPT — an instruction the model did not follow

**A prompt is a request. Every entry here was fixed by removing a decision rather than rewording one.**

| Failure | Frequency | Mitigation |
|---|---|---|
| Answered a club question with no tool call, deciding on its own authority it was out of scope | Intermittent | ✅ `tool_choice: any` on the first inference |
| Stored a preference from an aside, despite *"never call this because a preference seemed implied"* | ~1 in 3 | ✅ Write policy in code |
| Announced *"and save that you like to play early"* before a save that was then refused | Intermittent | ✅ Preambles suppressed |
| Looked up bookings it already had in its prompt, ending the turn | ~1 in 3 | Prompt only — **still a request** |
| Chose `list_my_bookings` over `amend_booking` | ~1 in 3 | Prompt only — **still a request** |

**Two of these are still prompt-enforced**, and both merely cost a turn. They are on the improvement plan and not on the launch conditions, which is a judgement I would defend but not insist on.

---

## Root cause: WORKFLOW — the loop did something the parts did not

| Failure | Frequency | Mitigation |
|---|---|---|
| **A bare "yes"/"no" spent on the wrong question** — "no thanks" nearly cancelled a booking; "yes please" bought a $20 guest | 3 occurrences, 3 different costumes | ✅ Answered in code before the model is called |
| Cancel-then-rebook across two turns destroyed a booking, because there was no amend tool | Every correction | ✅ `amend_booking`, one intent |
| A refused terminal tool ended the turn — the guard turned a bad outcome into **no** outcome | Every guarded refusal | ✅ Terminal only when a reply was produced |
| An aside printed before the answer | Intermittent | ✅ Asides sort last |
| `MAX_STEPS` bounded inferences, not work — 12 tool calls inside a ceiling of 6 | On demand (red team) | ✅ Per-turn call cap |
| Draft armed without the member being asked | Whenever batched with a terminal tool | ✅ Asking and arming are one statement |

> **The bare yes/no is the recurring one.** Three appearances, in project 01 and twice here, and the third nearly cancelled a booking. *A one-word answer is meaningless without the question it answers, and a model asked to infer which question will sometimes pick the destructive reading.*

---

## Root cause: KNOWLEDGE — the corpus, or what reached it

| Failure | Frequency | Mitigation |
|---|---|---|
| A stale document beat authoritative data on a booking rule | Day 9 | ✅ Fixed in the corpus |
| YAML comments invisible to the model — the parser drops them | Systemic | ✅ `meaning:` keys |
| The abstention branch was an uncited escape hatch | Any decline | ✅ Routing only, `contact` enum, figure check |
| Staleness never reached the member | Any stale citation | ✅ Computed in code |
| **`fees.yaml` dropped from what the agent was given** — every fee question declined | *planted, day 13* | ✅ Seam case; **found in 20 min from traces** |

---

## Root cause: MODEL LIMITATION — it cannot know

| Failure | Frequency | Mitigation |
|---|---|---|
| Did not know what day it is — booked against **2025** | Every relative date | ✅ Today's date in the prompt |
| Resolved a mistyped weekday to the wrong day | Any typo | ✅ Code checks the named weekday |
| Read "the same three lads" as the party for *this* booking, when the member said "just me" — **$60** | ~1 in 3 | ✅ Solo guard corrects the party |
| Invented a guest from a bare "yes" to a compound question — **$20** | Intermittent | ✅ Guests need evidence in the member's words |

---

## Root cause: INTEGRATION — the supplier

| Failure | Frequency | Mitigation |
|---|---|---|
| No idempotency keys; a Google Sheet never will have | Every ambiguous write | ✅ Client store, three states, reconciliation |
| Read-to-write gap widened from milliseconds to a conversation | Every contended slot | ✅ Holds, refreshed per turn |
| 404 on a member reported as *"the tee sheet is down"* | Any unknown member | ✅ `transient` carried through |
| A failed lookup reported as *"I can't find that booking"* | Any outage during an amend | ✅ Distinguished |
| **Staff edit the sheet mid-conversation** | Continuous | ⚠️ **Unmitigable.** Holds narrow it; a spreadsheet cannot enforce them |

---

## Root cause: TOOLING — the things we debug with

**Included because they cost more time than the agent's own defects, and because a broken instrument is a defect in the system that uses it.**

| Failure | Found by |
|---|---|
| The trace logged the model's **request** as though it were the outcome | Reading a trace |
| A handoff reported a **refused** booking as `✓ Booked` — success inferred by matching prose | Reading a package as the manager |
| ATTEMPTED said *"(nothing)"* on an escalation after two bookings | Reading a package as the manager |
| The knowledge call's **context window was never recorded** | The debugging exercise |
| `span()` accepted an `input` override and **silently ignored it** — recorded `""` and looked fixed | Dumping the raw payload |
| Hardcoded base URLs, **three times** — `reliability.ts`, `conversation-eval.ts`, and one with a `.catch` hiding it | The pre-push hook |
| Refused calls counted as executed ones, **three times** | Every time, a case failing where the guard had worked |
| Date fixtures rotted, **twice** | The suite failing on a Friday |
| A guard that read every **Monday as a Sunday** | Using it |

> **"Refused counted as executed" happened three times in three different files.** That is not carelessness, it is a missing concept: *attempts are not outcomes*, and nothing in the type system said so.

---

## What has no mitigation

| | Why it is open |
|---|---|
| **Identity is unauthenticated** | The component does not exist. Every other control assumes it |
| **No erasure for traces or the escalation queue** | Both stores were built after the erasure work |
| **Retention not enforced** | 30 days is a document, not a job |
| **Wrong memories have the longest detection time** | Weeks, and only if a member asks what we know |
| **Injection via free text a human re-introduces** | The complaint text a manager may paste back is untested |
| **Nowhere to run** | The queue exists while a terminal is open |
| **A fifth escalation path is unproven** | `end_turn` explaining a refusal would arm nothing. Not seen in six runs; left to see whether it happens |
