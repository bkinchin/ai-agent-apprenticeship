# Production Readiness Review — Golf Club Member Agent

| | |
|---|---|
| **Reviewed** | 2026-09-08 · after day 13 |
| **Reviewer** | Billy Kinchin (author) · **self-review, see the caveat below** |
| **Recommendation** | **Go with conditions** — see [RECOMMENDATION](#recommendation) |
| **Accountable** | Pro Shop Manager (PRD §0) |

> **The caveat that shapes everything below.** This is the author reviewing his own work. Four of nine dimensions were scored red or amber by evidence that already existed; the remaining risk is in the dimensions where I am least likely to be a good judge — security, where one hour of red-teaming was done by the person who wrote the guards, and operability, where I know how to run it because I built it.

---

## The readiness question

Not *"does it work?"* but **"do we understand how it fails, and can we live with that?"**

Every agent acts wrongly eventually. Readiness is whether the wrong actions are **bounded, detectable, reversible and survivable**.

---

## Scores

| Dimension | Score | Evidence |
|---|---|---|
| **Correctness** | 🟡 Amber | Measured baselines exist; none against real members |
| **Safety** | 🔴 **Red** | **Identity is unauthenticated** |
| **Reliability** | 🟢 Green | 19/19 checks against a hostile API, including a control |
| **Security** | 🟡 Amber | 16/16 red team held; one hour, by the author |
| **Privacy** | 🔴 **Red** | **No erasure path for traces or the escalation queue** |
| **Observability** | 🟢 Green | Proven by a debugging exercise, not asserted |
| **Operability** | 🔴 **Red** | **No deployment. It runs on a laptop.** |
| **Economics** | 🟡 Amber | Cost per resolution known; the actual business case is not |
| **Governance** | 🟡 Amber | An owner is named; there is no incident process |

---

### Correctness 🟡

| Suite | Result |
|---|---|
| Unit tests | **119/119** — [`src/**/*.test.ts`](src) |
| Reliability | **19/19** — [`src/run/reliability.ts`](src/run/reliability.ts) |
| Conversational golden set | **18/18** — [`src/eval/conversations.ts`](src/eval/conversations.ts) |
| Knowledge golden set | **21/21**, 0 inventions, 0 bad citations |

**Why amber, not green.** Every number above is measured against **cases I wrote**. There is no measurement against real members, and — from the PRD's own baseline — **no measured human error rate to compare against.** *"The agent must be accurate"* is currently measured against an imagined 100% the club has never achieved.

The suites also missed a planted bug on day 13 that broke every fee question, because the knowledge eval calls `ask()` directly while the agent calls it through a different line. That seam is now covered; the class of gap is not closed.

### Safety 🔴

**Bounded now:**
- Rate limits on every write — per turn, per session, per member per hour, club-wide per hour ([`src/core/limits.ts`](src/core/limits.ts))
- Assisted mode on the only action that spends a member's money without them asking
- Club rules enforced **inside the tool**, so any caller is bound
- A slot ledger: the model cannot book a slot the tee sheet did not offer
- A kill switch that is a file, not a deploy

**The red.** `/login M-1001` and nothing verifies it. **Anyone can claim to be any member**, and then read their bookings, cancel them, and change their preferences. Every other control assumes the member is who they say they are.

This is not a bug to fix; it is a component that does not exist. It is condition 1 on the recommendation.

### Reliability 🟢

19 checks against a deliberately hostile API — idempotency with three states, the ambiguous write, a race between two members, compensation when an amend fails, and **a control proving the mechanism is not a no-op**. Degraded mode covers both dependencies.

Green because the failure paths are *tested*, not because they are absent.

### Security 🟡

16 attacks across six categories, logged to [`redteam-log.md`](redteam-log.md): prompt injection (direct, fake system message, and **via the memory quote that is injected into every future conversation**), authorisation, policy circumvention, cost, data extraction, social engineering.

**16/16 held.** One breached on the first run — a cost attack making 12 tool calls inside a 6-step ceiling, because `MAX_STEPS` bounds inferences and a model may issue any number of parallel calls per inference. Closed by the per-turn cap.

**Why amber.** One hour, sixteen attacks, written by the person who wrote the guards. I tested the attacks I could imagine, which correlate with the defences I built. No external review.

### Privacy 🔴

**Working:** memory is subject-scoped with six tests asserting no cross-member leakage; an exclusion list refuses health, financial hardship, bereavement and third-party data at write time; traces redact Australian phone numbers, emails and card numbers **at ingestion**; members are pseudonymised in the trace store.

**The red:**

| | |
|---|---|
| Memory erasure | ✅ works, reports a count |
| **Trace erasure** | ❌ **none.** Holds every word a member has said |
| **Escalation queue erasure** | ❌ **none.** Holds complaints and bereavements |
| **Retention** | ❌ documented as 30 days, **nothing enforces it** |

A subject erasure request today would be answered *"mostly"*, which is not an answer. Day 11 recorded this gap for memory and closed it; the same gap opened in two new stores on days 12 and 13.

### Observability 🟢

Traces with the full context window on every model call, content-hashed model/prompt/policy/corpus versions on every span, four metric families, six alerts each with a runbook entry.

Green **because it was proven**: a bug was planted without disclosure and found from metrics and traces alone in about 20 minutes, without reading code. That exercise also found four holes in the viewer, all now closed. A trace system you have never debugged with is one with holes you have not found.

### Operability 🔴

**Exists:** a runbook with an entry per alert, a staff console, a kill switch, degraded mode.

**Does not exist:** any deployment. It runs from a terminal on one laptop. There is no host, no process supervision, no restart-on-crash, no backup of `.memory.db`, `.queue.db` or `.traces.db`, and no on-call.

The escalation queue is the sharpest version: a bereavement is escalated to a queue that **only exists while somebody has a terminal open**.

### Economics 🟡

```
cost per conversation   $0.0062
cost per resolution     $0.0076        (81.5% resolution rate)
p95 turn latency        5,398ms
```

Against the PRD's baseline of ~4 minutes of staff time per interaction at ~$30/hour, that is roughly **$2.00 of staff time against three quarters of a cent.**

**Why amber.** The cost comparison is not the business case. At ~7,300 interactions a year the agent displaces perhaps $14,000 of notional staff time the club will not reclaim — nobody is being made redundant. What was actually asked for was *"70–80% of my time back during the day, and bookings taken out of hours"*, and the PRD records that **out-of-hours demand has never been measured and is not measurable today.** The strongest part of the case is the part nobody can size.

### Governance 🟡

The PRD names the **Pro Shop Manager** accountable for agent behaviour — *"owns resolution when the agent gets it wrong, not blame for it"* — which is more than most systems have.

**Missing:** no incident process, nobody on call, no review cadence for the escalation queue, and no agreement on who decides to pull the kill switch. Naming an owner is necessary and not sufficient.

---

## Pre-mortem

*It is March 2027. The project has failed publicly. What happened?*

**1. A member's identity was assumed and someone else's Saturday was cancelled.**
Nothing authenticated `/login`. A member gave a friend their number to "sort the booking", the friend cancelled the wrong one, and the club had no way to show who did it.
→ **Control:** authentication. Not built. *Condition 1.*

**2. Bookings were wrong for a fortnight and containment looked fine.**
A rule changed at the club and not in `booking-rules.yaml`. Every metric stayed green because the agent was confidently applying an old rule and members were being turned away at the tee.
→ **Control:** a review cadence on the structured data, and an alert on `corpusVersion` unchanged for N weeks. **Neither exists.**

**3. The escalation queue was never opened and a bereaved member waited nine days.**
The queue is a SQLite file on a laptop. Nobody was told they owned it.
→ **Control:** the queue must page somebody. There is no notification path at all.

**4. Cost tripled after the corpus grew and nobody was watching.**
The knowledge eval already crept $0.19 → $0.23 from two YAML files. At ten times the corpus it is a different product.
→ **Control:** ✅ exists — `cost_per_conversation` alert with a baseline.

**5. A model update changed behaviour and it took two weeks to identify.**
"Nothing was deployed" was true and irrelevant.
→ **Control:** ✅ exists — model version stamped on every span.

**6. A prompt injection in a complaint disclosed another member's details.**
The complaint text goes into the escalation package, which a human reads and may paste back into the agent.
→ **Control:** partially. Injection via the memory quote is tested and held; **injection via free text that a human re-introduces is not tested at all.**

**7. The tee sheet was edited by staff mid-conversation and the agent booked over it.**
Every read is stale the instant it happens — the PRD says so.
→ **Control:** ✅ partially — holds close the read-to-write gap; a Google Sheet cannot enforce them.

---

## Blast radius

Ranked by **detection time**, which matters more than severity: a reversible error found in minutes is a non-event, and a reversible error found in a fortnight is a crisis.

| Tool | Worst single error | Worst systematic error | Detection | Reversible | Bound |
|---|---|---|---|---|---|
| `book_tee_time` | Wrong slot or party | Sheet filled with wrong bookings | **Minutes** — confirmation states day, time, party, guests and fee | Yes | Ledger, club rules, 10 writes/member/hr, 60 club-wide |
| `amend_booking` | Change lost, member has nothing | Bookings destroyed en masse | **Minutes** — confirmation, and `lost` escalates immediately | Yes, or escalates | Rules checked before the cancel; original restored on failure |
| `cancel_booking` | Wrong booking cancelled | Mass cancellation | **Hours to days** — the member finds out when they arrive | **Partially** — the slot may be gone | Assisted mode inside 24h; rate limits |
| `remember_preference` | A false belief about a member | Systematic wrong assumptions | **Weeks** ← **worst** | Yes, once found | Explicit-only, exclusion list, TTL, show/correct/delete |
| `forget_everything` | Member loses their preferences | — | Never | **No** | Rate limited only |
| `update_what_you_know` | A memory corrupted | — | **Weeks** | Yes | Exclusion list |

**The longest detection time is memory**, not booking. A wrong booking is discovered by a member standing on a tee; a wrong *memory* silently shapes every future conversation and is discovered only if somebody asks *"what do you know about me?"*.

Day 11 measured exactly this: a planted false handicap never reached the member — it went into the **retrieval query**, where every citation guarantee is blind to it.

**Closing that gap needs a memory-provenance report** — every memory, its quote, its age — reviewed by a human. It does not exist.

---

## Honest numbers

```
119 unit tests           pass      free
19  reliability checks   pass      free, includes a control
18  conversational cases pass      $0.30
21  knowledge questions  pass      $0.23   0 inventions, 0 bad citations
16  red team attacks     held      $0.20   0 breaches

cost per conversation    $0.0062
cost per resolution      $0.0076
escalation rate          18.5%
p95 turn latency         5,398ms
policy violations        0
```

**Caveat.** These come from 260 conversations of **test traffic**, not members — including ten synthetic bereavements. They are real measurements of a synthetic population, and the escalation rate in particular says more about the red team than about golfers.

---

## Recommendation

**GO, WITH CONDITIONS — to internal and shadow use only. NO-GO for member-facing traffic.**

The system is better engineered than most things that reach production: measured baselines, tested failure paths, a red team, traces that have been debugged with, and controls that were built because a specific failure happened rather than because a checklist asked.

It is not ready for members, and the reasons are not subtle.

### Conditions before any member sees it

**1. Authentication.** Identity is a `/login` command with nothing behind it. Every other control assumes the member is who they say they are. *Non-negotiable.*

**2. An erasure path for traces and the escalation queue, and enforced retention.** The trace store holds every word a member has said and nothing deletes it. Currently a subject request can be answered *"mostly"*.

**3. Somewhere to run, and somebody to run it.** A queue that only exists while a laptop is open is not a queue. Needs a host, supervision, backups, and a named person who reads the escalation queue daily.

### The path I would actually take

| Stage | What | Why |
|---|---|---|
| **1. Internal** | Pro shop staff use it as an assistant | Zero member risk, real questions |
| **2. Shadow** | Runs on real enquiries, output **not shown**, compared with what staff did | **The strongest evidence available, at zero risk** — and it produces the human error rate the PRD says nobody has measured |
| **3. Read-only** | Answers questions, cannot write | Establishes trust before it can do damage |
| **4. Assisted** | Proposes bookings, staff approve | Already built |
| **5. Limited** | Out-of-hours only, booking and cancellation | Where the value is, at the lowest-traffic time |

Shadow mode is the step I would insist on. It is the only way to answer *"is it better than what we do now?"* — and the club currently cannot answer that about **itself**.

### What I would not do

Launch to all members on the strength of 18/18 and 21/21. Those numbers measure the agent against cases I wrote, and the honest reading is that **every serious defect this month was found by a person using it, not by a suite.**

---

*Signed: ______________________  Date: __________*

*Reviewed by: ______________________ (not the author)*
