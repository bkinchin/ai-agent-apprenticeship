# Memory Design

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 11

What this agent remembers between conversations, what it refuses to remember, and the measured cost of getting it wrong.

---

## The sentence the design rests on

> **Memory is a database of unverified assertions that you inject into every future prompt.**

State is what was *said* and is reliable. Memory is what was *concluded* — and conclusions can be wrong, stale, or built on a misunderstanding, after which they persist and quietly steer every future conversation with a member who never agreed to them.

---

## What is stored: preferences, and nothing else

Four candidates went through one rule — **if a system of record knows it, don't remember it, look it up** — and three did not survive.

| Candidate | Where the truth lives | Verdict |
|---|---|---|
| Tee times booked | The tee sheet. `list_my_bookings` | **Lookup** |
| Guests used this month | `getMemberAllowance.guestsUsedThisMonth` | **Lookup** |
| Membership expiry | The CRM | **Lookup** — and see below |
| Previous conversations | Nothing records this | **Memory** |

Remembering a booking would build a cache with no invalidation over a system that changes without telling you — a member books by phone on Thursday, and on Friday memory and the tee sheet disagree. **Memory speaks with more confidence, because it isn't waiting on a network call.**

There is no CRM in this project, which makes membership expiry tempting. It is not:

> **A missing system of record is not a licence to infer. It is a missing dependency.**

### The fourth candidate turned out to be a database row

Asked to write the sentence we would want injected about a past complaint, the answer came back:

```
Member xyz raised complaint 123 on May 4th. Escalated to the
             ^^^^^^^^^^^^^        ^^^^^^^                 
             ticket id            created_at              

greenkeeper and is still with him.
^^^^^^^^^^^     ^^^^^^^^^^^^^^^^
assignee        status
```

A **ticket**, with a lifecycle somebody owns. As memory, `status` freezes at the moment of writing and ages into a lie — the green is fixed in June and the agent still says it is outstanding. **The field you most want is the one memory is worst at.**

Recorded as a missing system: complaint tracking, needed by day 12's escalation work.

What remained after removing the ticket was preference. That is what this stores.

---

## What is never stored

| Category | Why it is not obvious |
|---|---|
| Health / medical | The FAQ permits advance buggy booking *on medical grounds* — so the agent **must** handle it in conversation. It must not still know next March |
| Financial hardship | *"I'm struggling with the renewal this year"* |
| Relationship change | *"my wife and I have separated, cancel her membership"* |
| Third parties | Another member's handicap, health or membership |
| Named-staff complaints | Becomes an HR record by accident |

> **An exclusion list is not about what the agent may hear. It is about what survives the conversation.**

Enforced at write time in code, and checked against the **quote** as well as the value — a sanitised value with a sensitive quote behind it still puts the sensitive text in the database, and the quote is the field we promise to show the member.

### It is a backstop, not the defence

The list failed `"the barman was rude to me"` until that rule stopped being a single regex: `"complained about the rude barman"` and `"the barman was rude"` put the same two ideas in opposite orders. Day 9 said it plainly — **you cannot enumerate the ways a sentence can be phrased.** What actually keeps these categories out is the write policy.

---

## Write policy: explicit only, enforced in code

Day 11 lists four policies. This is the first, and it is the right start: lowest recall, highest precision, **zero surprise** — which is most of what separates memory that feels useful from memory that feels creepy.

The cost is asymmetric. A missed preference is an inconvenience the member can restate. A wrong one is the agent acting confidently on a belief the member never held and cannot see.

### It failed twice as a prompt instruction

The tool description said *"never call this because a preference seemed implied."*

**Failure 1.** Told *"the 9:20, just me. I usually play early with the same three lads"* — an aside inside a booking request — the model stored two preferences, one of them inferred:

```
group_size = "4 players: member plus 3 regular mates"
```

That belief would be injected into every future conversation and bias later bookings toward four players, **manufacturing the very defect the booking confirmation had just been changed to detect.** A wrong memory does not sit still being wrong; it reproduces.

**Failure 2.** The first code fix accepted a bare affirmative as permission, on the reasoning that the model would only ask immediately before storing. It did not. Asked *"will 9:30 work, or would you prefer 9:10?"*, the member said *"yes please"* — and the model spent that yes on a preference quoted from a turn earlier. **The member agreed to a tee time and got a memory.**

### What it is now

| Member says | Result |
|---|---|
| A **standing instruction** — *remember / from now on / always / I'd rather* | Stored |
| A **description of habit** — *usually / normally / tend to* | Not stored. The agent may **offer** to note it |
| *"yes please"* with a draft held from last turn | That draft is stored — **not** whatever the model sends now |
| *"yes please"* with no draft held | Nothing |

The draft lives **in code**, survives exactly one turn, and cannot be substituted by the model. A yes meant for another question has nothing to unlock.

This is how the curriculum's fourth policy — human-confirmed — gets reached by closing the hole in the first.

---

### The offer interrupts, and that is accepted

A member who mentions a habit while booking is asked, in the same turn, whether to note it — costing them a round trip on the club's highest-volume job in exchange for a preference measured to be worth one saved round trip later.

Considered and kept. The alternatives were to offer only as a conversation ends, or to drop offering entirely and store only on an explicit *"remember that…"*. The last is the strictest reading of the policy and deletes code rather than adding it, but it means the agent learns nothing unless a member thinks to teach it, and most will not.

**Decision:** keep the offer. Revisit if members are observed declining it routinely — which is measurable, and worth measuring before arguing about.

## Retrieval

Capped at **8**, ordered by confidence then recency, expired rows filtered on read so decay works even if nothing sweeps. Injected with explicitly fallible framing:

```
What you know about this member from previous conversations. It MAY BE
OUT OF DATE and none of it has been verified — check anything that
matters before acting on it, and never state it as fact:
- before 09:00 (they told us on 3 March 2026)
```

The dates and the caveat are not decoration. Presented as fact, a model acts on an eleven-month-old preference with the same confidence it acts on a tool result.

## Contradiction and decay

**Last write wins, per key, for preferences.** A preference is a statement about the present — *"I'd rather have afternoons now"* replaces the old view rather than competing with it, and showing a model two conflicting preferences makes it ask a question the member has already answered. The old row is deleted rather than archived, because an archive nobody reads is a liability with no upside.

This would be **wrong for factual or episodic memory**, where two accounts of one event are genuinely informative. Not generalised.

| Type | TTL |
|---|---|
| Preference | 365 days |
| Episodic | 180 days |
| Factual | until contradicted |

A correction re-dates the memory and sets confidence to 1.0: a member bothering to fix it is stronger evidence than the inference that created it.

---

## Scoping — the catastrophic failure

**There is no function in the store that reads without a `subjectId`.** Not a convenience one, not a debug one. The unscoped query does not exist to be called by accident.

Six automated tests cover it and must never be deleted or weakened, including that one member cannot correct, delete or erase another's memories.

---

## What it is worth (exercise 11)

| | Reply to *"morning, can I get a game Saturday the 29th?"* |
|---|---|
| **Off** | *"Plenty of availability. What time suits you, and how many in your group?"* |
| **On** | *"Plenty of slots! I see you prefer before 09:00 — we've got several early ones from 7am. What time suits you…"* |

**One round trip saved.** Real, and modest. Honestly: that is a thin return for a store, an exclusion list, a write policy, decay, three transparency operations and a leakage test — and the case for building it rests more on the transparency obligations being cheaper now than retrofitted than on the conversational gain.

---

## What a wrong memory does (exercise 12)

Planted: `handicap = 4`. The truth is 22. Then asked about competition eligibility.

It never told the member their handicap. It did this:

```
search_knowledge({"question": "What tees do players with a handicap
                   index of 4 play off in the Club Championship?"})
```

**The false belief leaked into the retrieval query.**

Every day-9 guarantee checks that the *answer* matches its source. **Nothing checks that the question was true.** Had the corpus held a rule about scratch players, the agent would have produced a properly cited, fully verified answer to a question premised on a falsehood — and every alarm would have stayed silent.

It declined only because the corpus has nothing on handicaps and tees. **We were saved by a gap in the corpus, not by a mechanism.**

Two consequences:

1. **This is why the lookup rule exists.** A handicap belongs in the handicap system. A lookup returns 22.
2. **Tool arguments are a surveillance surface.** The contamination was invisible in the member-facing transcript and plain in the trace. Day 13 territory.

---

## When not to build this

If sessions are rare and independent, if the systems of record already hold what matters, **don't**. Memory adds a class of failure for a marginal experience gain.

For this club it is a close call, and the honest summary is that the store is small because the lookup rule ate most of it — which is the correct outcome, not a disappointment.
