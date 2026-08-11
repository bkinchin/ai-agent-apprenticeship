# PRD — Golf Club Member Agent

| | |
|---|---|
| **Owner** | Billy Kinchin |
| **Status** | Draft |
| **Version** | 0.1 |
| **Last updated** | 2026-08-10 |
| **Accountable for agent behaviour** | **Pro Shop Manager** — owns resolution when the agent gets it wrong, not blame for it |

---

## 1. Problem

Members want to book tee times, buggies and lessons. The club can only take those bookings for **8.5 hours a day**; members want them at all hours. Everything outside that window either waits until morning or does not happen at all.

### Current process

Member phones or emails the pro shop. A staff member takes the details, enters them into the tee sheet, and a confirmation email goes out. Roughly **20 member interactions a day**.

### Baseline

| | Today | Confidence |
|---|---|---|
| Volume | ~20 interactions/day · ~7,300/year | Estimated |
| Staffed hours | 08:00–16:30, Mon–Sun (8.5h of 24) | Known |
| Cost per interaction | ~4 min of staff time · ~490 staff-hours/year | Estimated |
| Time to resolution | Immediate if staffed; **up to 16 hours** otherwise | Known |
| Current error rate | **Not measured.** Comparable operations run 92–97% | **Unmeasured — see below** |
| Demand outside staffed hours | **Not measured, and not measurable today** | **Unmeasured** |
| Member satisfaction | Not measured | Unmeasured |

### Three findings from the baseline

**1. Nobody has measured the error rate.** This is the single most important gap. Without it, "the agent must be accurate" is measured against an imagined 100% that the club has never achieved. Measuring it is cheap — sample 100 bookings against their confirmation emails and count the corrections — and it should happen **before** any accuracy target in this document is agreed.

**2. The most valuable demand is invisible.** A member who wants to book at 9pm on a Tuesday either waits until morning or doesn't book. The club has no record of the second group, so the strongest part of the business case is the part it cannot currently size. Out-of-hours volume should be treated as an **assumption to be tested in rollout**, not a projected benefit.

**3. There is already an error-detection mechanism, and it works only half the time.** See below — this turns out to drive an architectural decision.

### How errors surface today

> *"Wrong time or date gets booked. Confirmation email goes out. Sometimes the customer catches it then. Sometimes when they show up."*

Two distinct outcomes with very different costs:

| Caught by | When | Cost |
|---|---|---|
| Confirmation email | Minutes–hours | One phone call. Recoverable. |
| **Turning up** | Days later | Member has driven to the club for a slot that isn't theirs. Often in front of other members. Damages trust disproportionately. |

**The confirmation email is the club's existing error-detection loop.** It is the reason this is a manageable problem today rather than a chronic one.

#### Architectural consequence

The confirmation email **must be generated from the tee-sheet record, never from the agent's message.**

This is not a preference. An agent's characteristic failure is *say/do divergence* — telling the member "Saturday 9am" while writing Sunday to the sheet. If the confirmation is composed by the agent, it will faithfully repeat "Saturday", the member will be satisfied, and the error becomes invisible until they turn up. **An agent-written confirmation converts every recoverable error into an unrecoverable one.**

Generated from the record, the existing loop keeps working — and works *better* than it does today, because the record is always what the member reads.

*(Anti-requirement and integration consequences follow in §4 and §5.)*

---

## 2. Jobs to be done

Scored on three axes. **Checkability** is the one that does the most work: *is there a fact somewhere that settles whether the agent got it right?* Not "how hard is it to look up" — whether a verdict exists at all.

| Job | Trigger | Frequency | Checkable? | Blast radius | In v1? |
|---|---|---|---|---|---|
| **Book a tee time** | "Can I get a slot Saturday morning?" | High | **Yes** — row in the tee sheet | **Large** — visible, embarrassing, affects others | ✓ |
| **Cancel a tee time** | "Something's come up, cancel Sunday" | High | **Yes** — slot released or not | **Large** — a released slot is taken by someone else within minutes | ✓ |
| **Book a buggy** | "Can I get a buggy with that?" | High | **Yes** — allocation record | Small — a walk, or a refund | ✓ |
| **Book a lesson** | "Can I get an hour with the pro?" | Medium | **Yes** — booking exists | Small — rescheduled | ✓ |
| **Invite a guest** | "Can I bring a guest on Saturday?" | Low | **Yes** — booking + allowance decremented | Medium — guest turned away at the first tee | ✓ |
| **Check membership status** | "When does my membership run out?" | Low | **Yes** — a date in the CRM | Small | ✓ |
| **Report a course problem** | "The 7th green is a disgrace" | Medium | **Partly** — see below | Medium — a mishandled complaint becomes two complaints | ✓ *(capture and route only)* |
| — **v1 line** — | | | | | |
| Explain what membership *includes* | "Does my membership cover a guest at weekends?" | Low | **No** — interprets a handbook | Medium — a wrong answer is discovered as a broken promise | ✗ |
| Renew membership | "Can I renew for another year?" | Low, but concentrated | Yes | **Large — takes money** | ✗ |
| Advise on membership tier | "Should I move to a 7-day membership?" | Low | **No** — advice | Medium — commercial, and the club benefits from the answer | ✗ |
| Dispute a charge | "I've been charged twice" | Rare | No | **Large — money + emotion** | ✗ |
| Equipment advice | "Which putter should I buy?" | Medium | **No** — no fact settles it | Small | ✗ **Never** |

### The v1 line, and why each exclusion sits where it does

**Seven jobs in. Six are fully checkable; the seventh is checkable on the half that can be, and deliberately reviewed by a human on the half that cannot.** That is not a coincidence — it is the selection criterion. Every v1 job produces a record that either matches what the member asked for or doesn't, which means every one can be evaluated, and therefore improved.

| Excluded | Why | Revisit? |
|---|---|---|
| **Explain what membership includes** | Low checkability. The agent will answer fluently and there is no way to tell from the conversation whether it was right. A *subtly* wrong answer surfaces months later as "I was told I could." | After v1, with citation-to-handbook and a measured accuracy bar |
| **Renew membership** | **Takes money.** Explicit product decision: the agent handles no payment in v1. | Only after the club has 6 months of evidence on non-financial jobs |
| **Advise on tier** | Advice with a commercial interest attached. The club profits from the answer, which makes an unverifiable recommendation a conduct problem, not just a quality one. | Not planned |
| **Dispute a charge** | Money, emotion, and it escalates to a human anyway. Routing it through an agent adds a step and removes goodwill. | **Never.** Straight to a human. |
| **Equipment advice** | No fact anywhere settles whether the advice was good. No system of record. Arguably the pro shop's job, not the club's. | **Never** in current form |

### The complaint job is different from the other six

It is in v1 as **capture and route only** — the agent never judges whether the green is actually in poor condition, and never promises it will be fixed.

Three ways this job could have been scoped, and why the middle one wins:

| | What the member gets |
|---|---|
| Excluded | *"I can't help with that."* Stuck, and worse than phoning. |
| **Capture and route** ✓ | Complaint recorded in their own words, routed to the greenkeeper, told what happens next |
| Resolve | The agent forming a view on greens. No. |

**Escalation is a product surface, not an error path.** Scoping it out because it "needs a human" would leave the most emotionally loaded interaction the club has to a dead end.

It also splits on checkability, which is why it is marked *partly*:

| Half | Checkable? |
|---|---|
| Was it captured and routed to the right person, with the member's words intact? | **Yes** — a record exists |
| Did the member feel heard? | **No** — and this half is the actual point |

This is the only v1 job where **what the agent says is the deliverable** rather than packaging around a booking. An efficient *"Logged. Reference #4471."* is a worse outcome than a slow human, and no assertion in any harness will catch that. It needs sampled human review from day one — see §7.

**Two exclusions are permanent, not deferred.** Disputes and equipment advice are marked *never* rather than *not yet* — a deliberate distinction. "Not yet" invites the question again next quarter; "never, and here is why" answers it once.

---

## 3. Capability specifications

Four jobs specified. Deliberately **not** the top four by volume — "book a buggy" is structurally the same document as "book a tee time", and writing it twice teaches nobody anything. These four differ in *kind*:

| Job | The example it sets |
|---|---|
| Book a tee time | Reversible write, high volume |
| Cancel a tee time | **Irreversible** write, with a fee |
| Invite a guest | Write constrained by **policy**, incurs a charge |
| Report a course problem | **Non-checkable** — the words are the deliverable |

Book a buggy and book a lesson inherit the tee-time spec, changing only the resource and dropping the competition constraint.

### A note on the numbers below

Two different things appear in the *Accuracy target* lines, and conflating them is a mistake:

| | Example | Where it is enforced |
|---|---|---|
| **A rate** | "wrong slot booked < 0.5%" | Measured, trended, improved |
| **A policy** | "never incur a charge without stating the amount" | **Code.** Not a rate. |

A percentage implies a tolerable number of failures. Some of these have none — not because we are ambitious, but because they are rules, and rules are enforced structurally rather than tuned. Anything written **0%** below is a policy and reappears in §4.

**All rate targets are provisional** until the club measures its human baseline (§1). They are set relative to an assumed 95%.

---

### Book a tee time

```
Trigger:         "Can I get a slot Saturday morning?"
                 "Anything going Sunday for four of us?"

Information:     Member identity (verified)
                 Date  ·  time window  ·  party size
                 Whether any of the party are guests → routes to guest spec

Tools:           get_member · check_availability · hold_slot ·
                 confirm_booking · get_competition_calendar

Success:         A tee-sheet row exists for the right member, date, time and
                 party size, AND a confirmation email generated FROM THAT ROW
                 has been sent.

Failure modes:   · Ambiguous date — "Saturday" when two are within range
                 · Requested slot is inside a competition window
                   (Sat 08:30–11:00)
                 · Member already holds 2 live bookings
                 · Date is more than 6 weeks ahead
                 · No availability in the window
                 · SAY/DO DIVERGENCE — message says one slot, sheet holds
                   another
                 · Held a slot and failed to confirm it (orphaned hold)

Escalation:      Member disputes a rule ("I've had 3 bookings before")
                 Tee sheet unreachable or erroring
                 Member asks for a competition slot

Accuracy target: Wrong slot written            < 0.5%  hidden until arrival
                 Failed to book when one       < 3%    visible, recoverable
                   was available
                 Say/do divergence             0%      POLICY — confirmation
                                                       generated from the row
                 Orphaned hold                 0%      POLICY — holds expire

Reversibility:   REVERSIBLE. A wrong booking can be cancelled and rebooked at
                 no cost more than 24h out. This is why the confirmation
                 burden here is low: state the slot, book it.
```

**Why the two rates differ by 6×.** A wrong booking is invisible until the member arrives; a missed booking is visible immediately and they phone. Failing to book is annoying. Booking the wrong thing is a member standing on the first tee at 8am with nowhere to go.

---

### Cancel a tee time

```
Trigger:         "Something's come up, cancel Sunday"
                 "I need to drop out of Saturday"

Information:     Member identity (verified)
                 WHICH booking — never inferred when more than one exists
                 Current time relative to the tee time (the fee boundary)

Tools:           get_member · list_bookings · get_cancellation_fee ·
                 cancel_booking

Success:         The named booking is released, the member was told whether a
                 fee applied BEFORE it happened, and a confirmation generated
                 from the record has been sent.

Failure modes:   · Wrong booking cancelled (member holds two)
                 · Fee stated incorrectly — wrong side of the 24h boundary
                 · Cancelled without stating the fee at all
                 · Member intended to AMEND, not cancel
                 · Cancellation succeeds, notification fails — member believes
                   they still hold the slot

Escalation:      Member disputes the fee
                 Cancelling inside 24h citing medical/bereavement grounds
                 Two bookings and the member cannot identify which

Accuracy target: Wrong booking cancelled       < 0.1%  IRREVERSIBLE
                 Fee misstated                 0%      POLICY — computed by
                                                       code, never the model
                 Cancelled without stating     0%      POLICY
                   the fee

Reversibility:   IRREVERSIBLE. The slot returns to the pool and is typically
                 taken within minutes. There is no un-cancel.
```

**The most dangerous job in v1, and intuition gets it backwards.** Booking looks like the risky operation and cancelling like cleanup. It is the other way round: booking is nearly free to undo; cancelling is permanent the moment someone else claims the slot — and now costs the member $15.

Three consequences follow from that one line:

- The booking is **named back to the member** before cancelling — never "your Sunday booking" when two exist
- The fee is **computed by code** from the timestamp, never stated by the model. The week-1 date bug with a $15 price tag on it.
- Confirmation is explicit and carries the number

---

### Invite a guest

```
Trigger:         "Can I bring a guest on Saturday?"
                 "Make that four — two of us are guests"

Information:     Member identity (verified)
                 Number of guests  ·  which booking
                 Guests already used this calendar month

Tools:           get_member · get_guest_allowance · check_availability ·
                 confirm_booking (with guest count)

Success:         Booking reflects the correct guest count, the allowance is
                 decremented, and the member explicitly confirmed the total
                 charge before it was incurred.

Failure modes:   · More than 2 guests in one booking (rule)
                 · Monthly allowance of 6 already used, or would be exceeded
                 · CHARGE INCURRED WITHOUT THE MEMBER CONFIRMING THE AMOUNT
                 · Allowance decremented but booking failed, or vice versa
                 · Member assumes guest fees are included in membership

Escalation:      Allowance exceeded and the member pushes
                 Member disputes how many guests they have used
                 Any request to waive the fee

Accuracy target: Charge without explicit       0%      POLICY
                   amount confirmation
                 Allowance miscounted          < 1%
                 Guest rules misapplied        < 1%

Reversibility:   PARTIALLY. The booking can be cancelled, but the $20/guest
                 charge and the allowance decrement reverse separately — two
                 systems, one of which may already have billed.
```

**The agent does not take money. It creates a liability** — which has none of the friction of a payment flow. No card, no total, no checkout screen. A member says "yeah bring Dave and Steve" and is $40 down.

That is why the amount confirmation is a **policy at 0%**, not an accuracy target: the charge cannot be incurred unless the exact figure was stated and confirmed.

---

### Report a course problem

```
Trigger:         "The 7th green is a disgrace"
                 "Bunkers on the back nine haven't been raked in a week"

Information:     Member identity (verified)
                 What  ·  where  ·  when they saw it
                 Nothing else — do not interrogate someone who is annoyed

Tools:           get_member · create_course_report · route_to_team

Success:         A report exists containing the member's OWN WORDS verbatim,
                 routed to greenkeeping, and the member has been told what
                 happens next and by when.

Failure modes:   · Member's words summarised away — the complaint sanitised
                   into "member reports green condition"
                 · Routed to the wrong team
                 · Agent AGREES the course is poor — a club position it has
                   no standing to take
                 · Agent promises a fix, a timescale, or compensation
                 · Efficient acknowledgement that reads as dismissal
                 · Complaint is actually about a person, not the course

Escalation:      Complaint concerns a named staff member — straight to a human
                 Member is distressed, or threatens to resign
                 Second complaint about the same issue

Accuracy target: Routed to wrong team          < 5%
                 Member's words not verbatim   0%      POLICY
                 Promised a fix or timescale   0%      POLICY
                 "Did the member feel heard?"  NOT A RATE — sampled human
                                               review, 20/week (see §7)

Reversibility:   N/A — nothing changes in the world. The RELATIONSHIP is what
                 is at risk, and no system reverses that.
```

**The only v1 job where what the agent says IS the deliverable.** Everywhere else the words are packaging around a booking that either exists or doesn't. Here there is no booking — the entire output is the conversation.

Which means **no assertion in any harness will tell you whether this job is working.** A perfectly-routed complaint with a curt acknowledgement is a worse outcome than a slow human, and every automated check passes it. This job needs sampled human review from day one; it is why §7 carries a review budget.

The agent must also never *agree*. "You're right, that green is terrible" is the club taking a position — issued by something with no standing to take one, on the record.

---

## 4. Anti-requirements

What the agent must **never** do. Each is specific, testable, and becomes both a policy rule and an eval case.

The third column is not in the standard template and is the most important one. **Where a rule lives determines whether it is a guarantee or a suggestion.** A rule enforced only by a system prompt is a request the model will honour most of the time and fail on the unusual conversation — which is exactly the conversation that matters.

| Mechanism | Strength |
|---|---|
| **Tool absent** | Absolute. A tool not in the request cannot be called. |
| **Policy engine** | Absolute, if it cannot be bypassed. |
| **State machine** | Absolute. The action does not exist in this state. |
| **Code guard** | Absolute for structure; brittle for meaning. |
| **Classifier** | Measured, never perfect. Must be calibrated. |
| **Prompt** | No enforcement. Correct for *explaining*, useless for *guaranteeing*. |

### Identity and data

| # | The agent must never… | Enforced by |
|---|---|---|
| 1 | Disclose any booking, charge or membership detail before identity is verified | **State machine** — lookup tools do not exist before VERIFIED |
| 2 | Reveal whether a given email or membership number exists on the system | **Code** — one shared failure response for "no such member" and "wrong details" |
| 3 | Act on one member's account while verified as another | **State machine** — verified identity is compared to the target of every write |

### Money

| # | The agent must never… | Enforced by |
|---|---|---|
| 4 | Process a payment, take card details, or issue a refund | **Tool absent.** No payment tool exists in v1. |
| 5 | Incur a charge on a member's account without stating the exact amount and receiving explicit confirmation **of that amount** | **Policy engine** — the write is refused unless a confirmation carrying the figure is recorded |
| 6 | State a fee it did not compute from the booking timestamp | **Code** — fee is calculated and passed to the model, never authored by it |
| 7 | Waive, discount, or promise to waive any fee | **Tool absent** + escalation |

### Irreversible actions

| # | The agent must never… | Enforced by |
|---|---|---|
| 8 | Cancel a booking without naming that specific booking back to the member and receiving confirmation | **Policy engine** — cancel refused without a confirmation matching that booking ID |
| 9 | Cancel more than one booking from a single confirmation | **Policy engine** — one confirmation, one booking |
| 10 | Infer *which* booking to cancel when the member holds more than one | **Code guard** — ambiguity blocks the tool, as with an unreadable date of birth |

### Saying and doing

| # | The agent must never… | Enforced by |
|---|---|---|
| 11 | Send a confirmation message composed by the model | **Architecture** — confirmations are generated from the tee-sheet record (§1) |
| 12 | State that a booking, cancellation or charge has happened before the tool has returned success | **Code** — the model is told the result; it does not predict it |
| 13 | Guess when a date, time or booking is ambiguous — it must ask | **Code guard** — ambiguity withdraws the tool |

### Club rules

| # | The agent must never… | Enforced by |
|---|---|---|
| 14 | Book inside a competition window (Sat 08:30–11:00) | **Policy engine**, from the competition calendar |
| 15 | Exceed any club limit: 2 live bookings · 2 guests per booking · 6 guests per calendar month · 6 weeks ahead | **Policy engine** — each limit a separate, individually testable rule |

### Complaints

| # | The agent must never… | Enforced by |
|---|---|---|
| 16 | Alter, summarise or paraphrase a member's complaint in the record | **Code** — the member's turn is stored verbatim; the model never rewrites it |
| 17 | Agree with a criticism of the course, the staff, or the club | **Classifier** (calibrated) + sampled human review. *No structural enforcement exists for this — see below.* |
| 18 | Promise a fix, a timescale, or compensation | **Classifier** + human review |

### Capability honesty

| # | The agent must never… | Enforced by |
|---|---|---|
| 19 | Claim it will pass something to a colleague for something it can do itself | **Prompt** (explanation) + **LLM judge** in evaluation |
| 20 | Offer, mention or imply a service outside v1 — equipment advice, membership tiers, what a membership includes | **Prompt** + **judge**, grounded on the real capability list |

---

### Three of these cannot be enforced structurally, and that is the point

**#17, #18 and #19 have no absolute mechanism.** You cannot remove the agent's ability to agree with someone, or to be encouraging about a timescale — those are properties of language, not capabilities.

This is worth stating plainly rather than hiding behind a policy table, because it changes what the club is buying:

- Rules 1–16 are **guarantees**. They will hold on the ten-thousandth conversation and on the adversarial one.
- Rules 17–20 are **measured behaviours**. They will be right most of the time, and the club needs a way to know the rate.

Anyone reading this document should be able to tell those two categories apart at a glance, because the second category is where the reputational risk actually lives — and it maps exactly onto the one v1 job (complaints) whose success cannot be asserted.

> A PRD that lists twenty "must nevers" without saying which are enforced and which are hoped for has promised twenty guarantees and can deliver sixteen.

---

## 5. Integration inventory

| System | Owner | Access | Latency | Read/Write | Idempotency | Risk |
|---|---|---|---|---|---|---|
| **Tee sheet** (Google Sheet, `Bookings` tab) | Pro Shop Manager | Sheets API | ~1 s | **Write** | **None** | Double-booking · lost updates · staff editing concurrently |
| **Membership** (same Sheet, `Members` tab) | Membership Secretary | Sheets API | ~1 s | Read | n/a | **PII in a Google Sheet** — see §10 |
| **Guest allowances** (same Sheet, `Guests` tab) | Pro Shop Manager | Sheets API | ~1 s | **Write** | **None** | Allowance and booking cannot be updated atomically |
| **Competition calendar** | Competition Secretary | Google Calendar | ~1 s | Read | n/a | Staleness · timezone |
| **Confirmation email** | Pro Shop Manager | SMTP / transactional | ~1 s | Write | Retry-safe | Must be generated **from the sheet row** (§1) |
| **Payments** | Finance | — | — | — | — | **EXCLUDED — see below** |

### Explicitly excluded: payments

No payment system is integrated in v1, deliberately. The agent takes no card details, processes no transaction, and issues no refund.

Guest fees and late-cancellation fees are **recorded as charges against the member's account in the Sheet** and collected by the club through its existing process. The agent creates a liability; a human collects it. See §4 rules 4–7.

---

### The tee sheet is the project risk

The curriculum's warning is that integration and data quality are harder than the AI. A Google Sheet makes that concrete: it is a perfectly reasonable way for a club to run today **and a genuinely unsafe system of record for an autonomous writer.**

Six properties it does not have:

| Missing | Consequence for an agent |
|---|---|
| **Idempotency** | A retried write creates a **second booking**. Network hiccups become double-bookings. |
| **Transactions** | "Create booking" + "decrement guest allowance" cannot both succeed or both fail. One will land alone. |
| **Row locking** | Two members booking the same slot both read "available", both write. |
| **Referential integrity** | A booking can reference a member who does not exist. |
| **A queryable audit trail** | Revision history exists but cannot answer "who changed row 412 and why". |
| **Exclusive writers** | **Staff edit the sheet directly, all day.** Every read the agent makes is stale the moment it happens. |

The last one is the one that cannot be engineered away. The agent is not the only writer and never will be — a member phones, someone opens the sheet, a row changes. Any check-then-write is racing a human being.

### The consequence: the agent must not write to the tee sheet

**Serialise the writes.** The agent never edits the sheet directly. It appends to a **booking-request log** — an append-only tab — and a single-threaded worker applies requests to the tee sheet in order.

| Property | How the log provides it |
|---|---|
| Idempotency | Each request carries a client-generated ID. Replaying it is a no-op. |
| Ordering | One worker, one queue. No two writes race. |
| Atomicity | The worker applies booking + allowance together, or neither. |
| Audit | The log *is* the audit trail, with the conversation ID attached. |
| Rollback | Reverse a request without reconstructing what happened. |

Appending to a log is the one thing a spreadsheet does safely, because it needs no read-then-write.

This costs latency: a booking is *requested* immediately and *confirmed* within seconds rather than instantly. That is a **product decision** and it belongs in this document rather than being discovered during build — the member is told "booking that now, confirmation in a moment", not "booked".

It is also the honest answer to the alternative: putting a real tee-sheet system in before v1. That may well be the right call, and this PRD does not decide it — it states the cost of not doing it.

### Open question for the club

Whether to migrate to a proper tee-sheet system before v1, or ship on the Sheet with the request log. **This is the single largest feasibility decision in the project** and it is not an AI decision. Recorded in §12.

---

## 6. Escalation design

Escalation is a **product surface**, not an error path. It is one of the seven v1 jobs (§2) and the most likely single point of member dissatisfaction, because it always arrives when something has already gone sideways.

| Trigger | Urgency | Target | Hours | SLA | What the member is told |
|---|---|---|---|---|---|
| Member asks for a person | Normal | Pro shop | Staffed | Immediate | *"Putting you through now."* |
| Member disputes a club rule or a fee | Normal | Pro Shop Manager | Staffed | Same day | *"I can't overrule that — passing it to the manager, who'll come back to you today."* |
| Complaint names a staff member | **High** | Pro Shop Manager, direct | Any | Same day | *"That needs a person, not me. I've sent it straight to the manager."* |
| Member distressed, or threatens to resign | **High** | Pro Shop Manager, direct | Any | Same day | Warm, brief, no process language |
| Tee sheet unreachable or erroring | **High** | Pro shop + ops alert | Any | 1 h | *"I can't reach the booking system. I've flagged it — please phone if it's urgent."* |
| Ambiguity the agent cannot resolve after asking twice | Normal | Pro shop | Staffed | Next working period | *"I don't want to guess at this — I'll have someone call you."* |
| Any request for a fee waiver | Normal | Pro Shop Manager | Staffed | Same day | *"Only the manager can do that. Passing it on."* |
| Anything outside v1 scope | Low | Pro shop | Staffed | Next working period | *"That's not something I handle — I'll pass it to the team."* |

### What the human receives

Never a transcript dump. A structured handover:

- Member name and membership number
- What they were trying to do
- **What the agent already did** — including anything written to the tee sheet
- Why it escalated, in one line
- The member's own words, verbatim, where the trigger was a complaint

The third item is non-negotiable. A handover that does not say what was already written leaves the human unable to act without reconstructing the conversation — and worse, at risk of doing the same thing twice.

### Out of hours

This is the hard case and the one the club will judge the project on, because **it is exactly when the agent is most valuable and least supported.**

The agent must never imply someone is coming. Outside 08:00–16:30 it states plainly what will happen and when:

> *"There's nobody in the pro shop until 8am. I've logged this and the manager will see it first thing — you'll hear back before 10am. If it can't wait, the club's emergency number is …"*

Two rules for out-of-hours escalation:

1. **Never a bare "I can't help with that."** If the agent cannot act, it says what happens next and by when.
2. **High-urgency triggers page the Pro Shop Manager regardless of the hour** — a distressed member or a broken tee sheet at 9pm is not a next-morning problem.

### Deliberately not automated

No auto-response, no ticket number as the primary reassurance, no "your query is important to us". A member escalating has already had one machine interaction that did not fully work. **The second one should feel like a person is now involved**, because one is.

---

## 7. Success metrics

Seven metrics. Every one has a measurement method — if it cannot be measured it is not in this table.

**Two are paired deliberately.** Containment and time-back both improve if the agent handles more conversations, and both improve *fastest* if it handles them badly. Each is therefore paired with a quality metric that moves the other way, so the pair cannot be gamed.

| # | Metric | Baseline | Target | Measurement method | Owner |
|---|---|---|---|---|---|
| 1 | **Out-of-hours bookings created** | **0** | ≥ 3/day by month 3 | Count bookings created 16:30–08:00 from the request log | Pro Shop Manager |
| 2 | **Out-of-hours booking error rate** *(pairs with 1)* | n/a | < 1% | Sample 50/month against confirmation-email corrections and no-shows | Pro Shop Manager |
| 3 | **Interruptions during staffed hours** | ~20/day | **< 8/day by month 3** | Count member-initiated contacts reaching a human | Pro Shop Manager |
| 4 | **Longest uninterrupted block, staffed hours** | ~25 min | **≥ 90 min** | Gap between human-handled contacts | Pro Shop Manager |
| 5 | **Containment** — resolved without a human | 0% | 60–70% | Conversations ending with no escalation and a completed job | Pro Shop Manager |
| 6 | **Escalation appropriateness** *(pairs with 5)* | n/a | ≥ 90% | Sampled review of 20 escalations/month: did this genuinely need a person? | Pro Shop Manager |
| 7 | **Complaint acknowledgement quality** | n/a | ≥ 4/5 | **Human review of 20 complaint conversations/week**, scored on whether the member was heard | Pro Shop Manager |

### Why #3 and #4 replace "70–80% of my time back"

The manager's stated goal was 70–80% of their day returned. The arithmetic does not support it:

```
20 interactions × 4 min      =  80 min/day
Staffed day                  = 510 min
                             = ~16% of the day
```

**A perfect agent handling every interaction returns ~16% of the day.** Writing 70% into this document would guarantee the project fails against its own criteria however well it worked.

But the manager is not wrong — they are describing the wrong quantity. 20 interruptions across 510 minutes is **one every 25 minutes**, which is what actually prevents the stock order, the lesson schedule, or a walk round the course. The cost is fragmentation, not duration.

So the metric is **interruption count and block length**, not time saved. Going from 20 interruptions to 6 saves barely an hour and turns a fragmented day into three clear ones. That is the benefit the manager will actually feel, stated in a way that can be met.

### Why #7 has a person in it

Complaint handling is the one v1 job whose success cannot be asserted (§3). A perfectly-routed complaint with a curt acknowledgement passes every automated check and is a worse outcome than a slow human.

**20 conversations a week, read by a person, forever.** Not a launch activity. It is roughly an hour a week and it is the only instrument that measures the thing most likely to cost the club a member.

### What is deliberately not a metric

- **Member satisfaction score.** No baseline exists, response rates on club surveys are low, and it would be measuring the club, not the agent.
- **Cost per conversation.** Tracked operationally, but at ~7,300 interactions/year the model spend is not what makes this project succeed or fail.
- **Time to first response.** Instant by construction. Measuring it flatters the agent and tells nobody anything.

---

*Sections 8–12 to follow.*




