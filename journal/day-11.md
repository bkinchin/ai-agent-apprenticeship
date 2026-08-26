# Day 11 — Memory

**Project:** 03-golf-club-agent · **Deliverable:** subject-scoped store, explicit write policy, transparency operations, leakage tests, `memory-design.md`

The day whose most useful output was deciding **not** to remember three of the four things on the list.

---

## The rule did most of the work before any code

> **If a system of record knows it, don't remember it — look it up.**

| Candidate | Truth lives in | Verdict |
|---|---|---|
| Tee times booked | The tee sheet | **Lookup** |
| Guests used this month | The allowance endpoint | **Lookup** |
| Membership expiry | A CRM this project doesn't have | **Lookup** |
| Previous conversations | Nothing | **Memory** |

Remembering a booking builds a cache with no invalidation over a system that changes without telling you — and **memory speaks with more confidence than a lookup, because it isn't waiting on a network call.**

The third row is the one worth keeping: there being no CRM made memory tempting. **A missing system of record is a missing dependency, not a licence to infer.**

### The fourth candidate was a database row

Asked to write the sentence I'd want injected about an old complaint, what came out was:

```
Member xyz raised complaint 123 on May 4th. Escalated to the
             ^^^^^^^^^^^^^        ^^^^^^^   ^^^^^^^^^^^^^^^
             ticket id            created_at assignee

greenkeeper and is still with him.
                  ^^^^^^^^^^^^^^^
                  status
```

A ticket. As memory the `status` field freezes at the moment it was written and ages into a lie — the green is fixed in June, the agent still says it's outstanding.

> **The field you most want is the one memory is worst at.**

---

## The write policy failed twice, and the second was my fix

**Explicit only** was the chosen policy — nothing stored unless the member asks.

**As a prompt instruction it lasted two conversations.** Told *"the 9:20, just me. I usually play early with the same three lads"*, the model stored:

```
group_size = "4 players: member plus 3 regular mates"
```

An inference, from an aside, inside a booking request — now injected into every future conversation, biasing later bookings toward four players. **A wrong memory doesn't sit still being wrong. It reproduces.**

**My first code fix was worse.** I let a bare affirmative authorise a write, reasoning the model would only ask immediately before storing. It didn't:

```
agent   "Will 9:30 work, or would you prefer 9:10?"
member  "yes please"
model   remember_preference(... quote from two turns ago ...)
```

> **The member agreed to a tee time and got a memory.**

The draft now lives in code, survives exactly one turn, and cannot be substituted by the model. A yes meant for another question has nothing to unlock. Which is how the curriculum's *fourth* write policy — human-confirmed — gets reached by closing the hole in the *first*.

---

## The planted wrong memory did something I didn't predict

`handicap = 4`. The truth is 22. Asked about competition eligibility, it never told the member their handicap. It did this:

```
search_knowledge({"question": "What tees do players with a handicap
                   index of 4 play off in the Club Championship?"})
```

**The false belief went into the retrieval query.**

> Every day-9 guarantee checks that the **answer** matches its source. Nothing checks that the **question** was true.

Had the corpus held a rule about scratch players, the agent would have produced a properly cited, verified, alarm-free answer to a false premise. It declined only because the corpus has nothing on handicaps and tees.

**Saved by a gap, not by a mechanism.**

---

## A booking bug found while testing memory

```
member  "the 9:20, just me. I usually play early with the same three lads"
model   book_tee_time({partySize: 4, guests: 3})
```

The member said *just me*. **$60 of guest fees nobody agreed to.** The slot ledger didn't catch it because the slot was legitimate — the ledger constrains *which slot*, never *who*. And the confirmation named neither field:

> *"You're booked — Saturday 29 August at 09:20."*

Now read back from the sheet and stated: *"4 players including 3 guests. Guest fees come to $60 on your account."* A member who said "just me" objects immediately.

**The fields that cost money are the fields the model gets wrong, and they were the two the confirmation left out.**

---

## Reflection

**1. On vs off. Was it worth the complexity?**

| | *"morning, can I get a game Saturday the 29th?"* |
|---|---|
| Off | *"Plenty of availability. What time suits you, and how many in your group?"* |
| On | *"I see you prefer before 09:00 — we've got several early ones from 7am…"* |

**One round trip.** That is a thin return for a store, an exclusion list, a write policy, decay, three transparency operations and a leakage suite.

The honest case for building it isn't the conversational gain. It's that **transparency and erasure are cheaper now than retrofitted**, and that the exercise established the lookup rule — which removed three quarters of the feature and is worth more than the quarter that remained.

**2. What did the wrong handicap do? How would you catch it in production?**

It contaminated a tool argument, invisibly. The member-facing transcript looked clean; the trace showed it plainly.

Three ways to catch it, weakest first:
- **Read transcripts** — would have missed this one entirely
- **Log tool arguments** and alert when a memory value appears in one — day 13
- **Don't store it.** A handicap is a lookup. The rule that would have prevented this was written down before the bug existed

**3. Which memories should really be a lookup?**

Three of the four, before writing any code — which is why the store is small. The residual risk is the *next* one: somebody will want the agent to "just know" a member's category, and the CRM call will feel like friction. That is the moment the rule earns its keep.

**4. "What do you know about me?" — would it feel helpful or unsettling?**

> Here's everything I've got written down about you:
>
> · before 09:00
>   you said on 3 March 2026: "I always want to play before 9am"
>
> Tell me if any of it's wrong, or say the word and I'll delete the lot.

**Helpful**, and the reason is the provenance rather than the list. *"We think you prefer mornings"* is surveillance. *"You said, on this date, in these words"* is a receipt — the member can see it wasn't deduced about them.

The whole list is shown rather than a summary, because a summary of what you know about someone, given to that person, is a way of not telling them.

**5. GDPR erasure. Where does the data live, and how long?**

| Location | Erasure |
|---|---|
| `.memory.db` | Instant — `forgetAll` returns the count |
| Traces | **Not persisted yet.** Becomes a problem on day 13 |
| Eval fixtures | None contain real member data today |
| Terminal transcripts | Uncontrolled. Scattered in scratch logs |
| **Model provider** | **The quote was sent in a prompt.** Outside my control, subject to the provider's retention |

The store is the easy part and the only part currently solved. **An erasure request today would be answered honestly with "mostly"** — and the un-erasable copy is the one created by using the memory, not by storing it.

That is an argument for storing the *least* that works, which is what the lookup rule already produced for different reasons.

---

## What day 11 was actually about

The store is about 200 lines. The exclusion list, the write policy, and the two experiments are the rest of it — and every defect this session came from the parts that decide **whether** to write, never from the part that writes.

> **Deciding what to remember is harder than storing it**, and the day's best output was the three things that turned out not to be memory at all.
