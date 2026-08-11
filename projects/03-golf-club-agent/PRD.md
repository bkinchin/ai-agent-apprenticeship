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

*Sections 4–12 to follow.*

