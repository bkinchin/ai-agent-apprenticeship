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

## The write policy failed four times

**Explicit only** was the chosen policy — nothing stored unless the member asks. It took four attempts, and **each fix created the next failure.**

### 1. As a prompt instruction it lasted two conversations

The tool said *"never call this because a preference seemed implied."* Told *"the 9:20, just me. I usually play early with the same three lads"*, the model stored:

```
group_size = "4 players: member plus 3 regular mates"
```

An inference, from an aside, inside a booking request — now injected into every future conversation, biasing later bookings toward four players. **A wrong memory doesn't sit still being wrong. It reproduces.**

### 2. My code fix let any "yes" authorise a write

I reasoned the model would only ask immediately before storing. It didn't:

```
agent   "Will 9:30 work, or would you prefer 9:10?"
member  "yes please"
model   remember_preference(... quote from two turns ago ...)
```

> **The member agreed to a tee time and got a memory.**

So the draft moved into code, survives one turn, and cannot be substituted by the model.

### 3. The draft was armed without anyone being asked

The refusal told the *model* to ask. It couldn't: the call arrived batched with `book_tee_time`, which is terminal, so the turn ended in the same iteration. The member was never asked — **and the draft was armed anyway**, so a stray "yes" later would have committed a memory nobody was offered. The bug from #2, back through a different door.

Code now asks in the same statement that arms it. **If we armed it, we asked.**

### 4. The exclusion list was reading the model's homework

A member said *"I've had a knee replacement so remember I'll always need a buggy"* and it was **stored**. The health rule never saw the medical clause, because the model handed over the quote `"I'll always need a buggy"` — correctly, by a tool description I'd written three commits earlier asking for the part that states the preference.

Two guards ran on the same turn from different sources of truth:

```
write policy    checks lastMemberTurn(s)   the member's actual words
exclusion list  checked the model's quote  whatever it chose to pass
```

The second is the model marking its own homework, which is precisely what the first was built to avoid. **Two guards on one turn must not disagree about where the truth is.**

---

## The paraphrase that shouldn't have existed

The consent question read: *"Would you like me to remember that for next time — `"early"`?"*

`"early"` was a **storage value** — the model's short label for a column — and a poor thing to ask somebody to agree to. Fixing the wording exposed the better question: *why is there a paraphrase at all?*

The store held two strings for one fact. The member's own words were shorter, clearer, unambiguous, and already required for provenance. The paraphrase bought nothing and inserted a model-authored step into **the one place where being exactly right is the entire product**.

Removed. The quote is the memory. They diverge only when a member deliberately corrects something, and then the display says so and keeps the original visible.

---

## Four more from one pasted transcript

A single conversation, read carefully:

| | |
|---|---|
| *"Let me book that and **save that you like to play early**"* | The save was then refused. A **preamble** — an intention stated before code decided |
| The "shall I note that?" recovery was unreachable | Batched with a terminal tool |
| **"no thanks" → `cancel_booking`** | They declined a *memory offer*. It failed only because it passed a slot id where a booking id belonged |
| 9:40 requested, 9:50 booked, silently | Truthful, and never mentioned it wasn't what they asked for |

The third is the one that matters. And it's the third appearance of one shape:

```
day 6   (project 01)  "ok go on then"  → recorded as a cancellation
day 11                "yes please"     → spent on a memory
day 11                "no thanks"      → nearly cancelled a booking
```

> **A bare yes or no is meaningless without the question it answers — and a model asked to infer which question will sometimes pick the destructive reading.**

Now answered in code, before the model is called at all. We know which question was asked, because we asked it.

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

## The reason all of this was found by hand

Every defect above came from a person typing at the agent. None came from the suite. There was a reason:

```
agent.ts     1112 lines   the largest file in the project.   ZERO tests.
```

No test called `turn()`. `isNegative` — the function standing between *"no thanks"* and a cancelled booking — had **no test at all**, an hour after being written to fix exactly that.

The cause was one line: `client.messages.create`, hardcoded. Testing the loop needed an API key, a network and a non-deterministic model, so it never happened. Which is CLAUDE.md's own review question, failing:

> *"Is it testable without an LLM? If not, the logic and the model call are tangled."*

The model is now a parameter. **Twelve loop defects are scripted responses with fixed assertions**, and four controls confirm they bite: removing preamble suppression, the yes/no short-circuit, forced `tool_choice` and aside ordering fails 1, 2, 1 and 1 tests.

---

## A conversational golden set, and what it caught in its first hour

Seven cases, asserted on **tool arguments** rather than prose — because every dangerous thing this agent has done was visible in an argument and invisible in the reply.

It found three things immediately:

**The $60 bug was never fixed.** I'd fixed *detection* — the confirmation names the party and the fee — and told myself that was the fix. It isn't: by the time the member objects, the booking is on the sheet and the guest allowance is spent.

**My prevention then broke something worse.** The guard refused the booking, and `book_tee_time` is terminal, so the turn ended before the model could read the refusal. **The member got no booking at all.** A tool is terminal because it *answered the member*, not because of its name.

**Refusing was the wrong instrument anyway.** My refusal offered the model a choice — *"book it as one player, or ask them"* — and it asked, leaving the member with nothing. Offering a choice put back exactly the non-determinism the guard removed. Code now believes the member: *"just me"* means one player.

### The lesson from the controls

Disabling the yes/no short-circuit left the suite **green**. That turn, the model happened not to reach for `cancel_booking`.

With `runs: 3` it failed on run 3 — putting the rate near **one in three**. A single-run suite would have missed it two times out of three while reporting green.

> **A single run of a probabilistic failure is a weak test**, and I nearly shipped it as a strong one.

### And the eval's own first assertion was wrong

It matched *attempted* calls, so it failed a case where the agent had done exactly the right thing — caught a bad party size and corrected it. That would have taught us to distrust a working guard. **A detector that reports failures it cannot substantiate**, for the third time in this project.

---

## Two mistakes worth keeping

**The trace lied.** A guard corrected a party size from four to one and the trace still showed four, because it logged the model's *arguments*. Everything downstream read a request as an outcome. A trace that shows the request but not the correction is **worse than no trace** — it is confidently wrong in the one artefact you consult when something has gone wrong.

**I committed on a red suite.** Tailed the output to six lines, the failure was above the fold, and it went in while I wrote that everything passed. The suite worked; the person reading it did not. Same failure as the judge that scored a dead API: the number was present, plausible, and unread.

---

## What day 11 was actually about

The store is about 200 lines. The exclusion list, the write policy, and the two experiments are the rest of it — and every defect this session came from the parts that decide **whether** to write, never from the part that writes.

> **Deciding what to remember is harder than storing it**, and the day's best output was the three things that turned out not to be memory at all.
