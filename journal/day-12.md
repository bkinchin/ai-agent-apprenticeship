# Day 12 — Human Escalation

**Project:** 03-golf-club-agent · **Deliverable:** escalation policy, four trigger sources, handoff package, queue, staff console, assisted mode, reverse handoff

The day whose objective is *"escalation as a product surface, rather than an error path."* The reframe landed before any code, because the club's own examples made it obvious.

---

## Only one of five situations was the agent failing

Asked which situations should reach a person, the answers were:

| | Situation | Why it escalates | What that means |
|---|---|---|---|
| 1 | Frustrated after a booking refusal | judgement + emotion | **Always a person** |
| 2 | Bank holiday opening times | not in `hours.yaml` | **Missing knowledge** |
| 3 | Wants to join | below the v1 line by PRD decision | **Out of scope, forever** |
| 4 | Competition results | no data source exists | **Missing tool** |
| 5 | Bereavement | not a request at all | **Always a person** |

**Two need a human. Three are things the agent could do and cannot yet.**

So every escalation records `missing` — knowledge, tool, policy, judgement or out-of-scope. Sorted by volume that field is the product roadmap, and without it the queue records *that* the agent gave up and not *why*, which is the actionable half.

> If bank-holiday questions escalate forty times in November, that is not an escalation problem. It is four lines of YAML nobody wrote.

---

## Detection matches the trigger's nature

```
"can I speak to someone?"       a PHRASE      → code, before any inference
"my husband passed away"        a PHRASE      → code, before any inference
same tool, same args, 3×        a COUNT       → code
"this is outside what I can do" a JUDGEMENT   → the model, via a tool
```

The two emotional triggers short-circuit **before the model is called at all** — not for cost, but because an LLM should not be composing a first response to a bereavement, however good it would be at it.

And the model may raise only **three** capability reasons. A bereavement, a request for a human, a loop and a step limit are not judgement calls, and letting the model declare them would make the most important triggers in the system depend on it noticing.

The **step limit** used to apologise and stop. Hitting the ceiling is the clearest possible signal that the agent is out of its depth, and it was the one signal being thrown away.

---

## Exercise 11 was worth more than the exercise suggested

Reading my own handoff package as the pro shop manager found **five defects**, and the worst two are the same shape.

```
ATTEMPTED (nothing — escalated before the agent attempted anything)
```

**False.** The agent had booked two tee times and been refused a third. The escalation fired on a *later turn* than the tool calls and was handed that turn's empty list. **The field the package depends on most was empty exactly when there was most to say.** A handoff summarises a conversation, not a turn.

Then, once it was populated:

```
✓ Booked 2026-08-31T10:00
```

That booking was **refused**. `describe()` decided success by matching the note against `/^(Refused|Not stored)/`, and the refusal read *"Not booked (not_permitted)"*.

> **I determined truth by parsing prose**, in the artefact a human uses to decide what to do — when the outcome was known at the source and thrown away.

Also missing: the transcript showed model **preambles** rather than what the member read; the refusal reason shown to staff was the model-facing note, *"Do not invent a fix"* included; and the member-facing sentence interpolated the staff-facing one, producing *"so cancel 2026-08-27 at 09:00 for m-1001 and charge the $15 fee. needs the pro shop to sign it off."*

**Four audiences for the same content, and text kept reaching the wrong one.**

---

## The question that was worth more than the bug

> *"That was written in the policy. How could it be forgotten when writing code?"*

Asked after the agent booked a member into the Saturday competition window. The obvious reading was one overlooked rule. An audit said otherwise:

```
max_days_ahead: 42        also HARDCODED as 42 in TypeScript
max_live_per_member: 2    taken from the SUPPLIER's response
min_notice_hours: 1       enforced NOWHERE — booked 10 min ahead
guests.max_per_booking: 2 enforced NOWHERE — booked 4 in one go, $80
guests.max_per_month: 6   taken from the SUPPLIER's response
tee_sheet_closures        enforced NOWHERE — the reported bug
```

**Three of six enforced nowhere, one duplicated, two delegated. The booking path had never read `booking-rules.yaml` at all.**

The cause is a seam rather than an oversight. The rulebook was written on day 9 for the *knowledge* agent; the tools on day 10 against the *API*. Each was correct about its own half, and nobody asked the question that joins them:

> **Does the supplier know the club's rules?**

For a Google Sheet that staff edit all day, obviously not — and day 9's note says exactly that, in a document about retrieval, where whoever wrote the booking tools had no reason to look.

**A one-rule fix would have shipped and the other five would still be live.**

---

## A guard worse than no guard

```
"monday" → "sunday"      two edits apart (m→s, o→u)
```

The weekday matcher accepted anything within two edits and walked the days in order, so `sunday` always won. Every Monday request was refused as a Sunday — **and the model then fabricated a date to escape**, telling the member Monday was 1 September.

> A guard that mangles correct input does not merely fail to help. It refused a date the member had given, and provoked an invented one.

Exact matches now win outright, and an ambiguous typo is not guessed at all.

---

## The one that cost money

```
agent:  "How many in your party, and will you have any guests?"
member: "yes"
model:  book_tee_time({partySize: 2, guests: 1})   → $20
```

**Third time a bare affirmative has caused a defect. First time it costs money.** The solo guard covered *"just me"*; it never covered **silence**, which is the commoner case because most members do not announce that they are playing alone.

---

## Changing a booking is one intent

```
you › but the second person is a guest?
     → cancel_booking(...)
     "That's cancelled."
you › so did you book me in or not?
```

A clarifying question about a **detail**, and the agent destroyed the booking. There was no tool for *changing* one, so the model built it out of two irreversible steps — and `cancel_booking` is terminal, so the rebook could not happen in the same turn even in principle. The member could only ever see the destructive half.

Day 10's rule, broken by omission: *never expose a saga as N tools and hope the model sequences them.*

The hidden half: an amend really is a cancel plus a rebook, so the model's improvised version would have sent a member correcting a guest count on tomorrow's booking into the **$15 late-fee queue**. **Fixing a typo must not cost money.**

Between the cancel and the rebook the slot is free for anyone, so rules are checked before anything is touched, the original is restored if the rebook fails, and if the restore also fails the outcome is `lost` — which escalates immediately, because the member is worse off than before they spoke to us and no sentence fixes that.

---

## Reflection

**1. Reading your own handoff package — what was missing, and why didn't you anticipate it?**

Five things, above. The two that matter shared a cause: **I wrote the package from the agent's point of view rather than the reader's.** ATTEMPTED was scoped to the turn because the escalation code lives in the turn; the refusal text was the model-facing note because that was the string to hand.

I did not anticipate it because I never sat in the chair. The exercise is *"read it as the staff member"*, and doing that took ninety seconds and found more than the previous hour of design.

What is still missing and could not be fixed honestly: **`MEMBER M-1001`**. There is no name and no phone number, because the club exposes no member directory to the agent. Left as a recorded gap rather than invented — the same call as day 11's absent CRM, and the same reason: a missing system of record is a missing dependency.

**2. What escalation rate would you target? What does too low tell you?**

Not a number — a **shape**. `judgement` and `out_of_scope` should be steady; `knowledge` and `tool` should trend to zero, because each one is a thing somebody can build.

**Too low means the agent is attempting things it should not.** For this club, a zero rate would specifically mean nobody has raised a bereavement, a complaint, or a membership enquiry — all of which happen — so the triggers are not firing rather than the situations not occurring.

The number I would actually watch is `agentCouldHave` from the console: if humans keep answering *yes*, the escalations are noise; if they keep answering *no* with `judgement`, the line is drawn in the right place.

**3. Assisted mode: which action, and is it economic?**

Late cancellation — inside 24 hours, where the member is charged $15. The human sees the exact call, its effect and why it needs them, and answers yes or no.

**Ten seconds against a four-minute phone call**, and it removes the only path where the agent could charge a member money on its own judgement. At ~20 interactions a day and cancellations a small fraction of those, this is a handful of ten-second decisions a week. Comfortably economic — and the calculation would look very different if it were every booking rather than every late cancellation, which is the argument for choosing the narrowest irreversible action rather than the most common one.

**4. Emotional classifier: which way do you tune?**

**Toward false positives, without hesitation.** A false positive costs one unnecessary phone call from the pro shop. A false negative is a bereaved member being handled by software.

Those are not comparable quantities, so they cannot be traded off against each other — which is why the guard is deliberately broad, why it runs before any inference, and why it is regex rather than a model. It must not depend on the model noticing, and it must not be tunable by anything the member says.

**5. The same member returns next week with the same issue. What should have happened?**

Three things, and only one exists:

- **Reverse handoff** ✓ — built today. The agent tells them what the human did, once.
- **The resolution should have changed the system.** If the pro shop grants a booking-limit exception every time, the limit is wrong or needs a documented exception path. The `missing` field captures which.
- **A repeat is its own signal.** A second escalation on the same trigger from the same member should escalate at higher urgency, and nothing does that yet.

The honest answer is that returning with the same issue means **the first escalation resolved the member and not the cause** — and a queue that only routes work will let that happen indefinitely. That is what day 19's improvement loop is for, and why the capture was built today rather than then.

---

## What day 12 was actually about

Nine defects, four found by a person typing at the agent, and the largest found by asking *why* rather than accepting a fix.

The pattern underneath most of them: **the agent kept offering things it would then refuse** — closed windows, a third booking, a slot it could not honour — because the offer path read the supplier and the refusal path read the club's rules.

> Withdrawing something a member has already chosen is a worse experience than never listing it, and it is the one they remember.
