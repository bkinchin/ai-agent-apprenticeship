# Tool Reliability

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 10

How the agent writes to a business system without double-booking anyone, and what it does when that system is unavailable.

---

## The claim this document rests on

**Almost none of this is about the LLM.** Idempotency, retry policy, circuit breakers, compensating actions and degraded mode are ordinary distributed-systems engineering, and they would be required for any automation touching a booking system.

The LLM changes exactly one thing, and it changes it a lot:

```
14:02:01  check_availability(Sat 09:20) → available
          "Great, 09:20 works — actually, can my brother-in-law come?
           He's a 14 handicap, is that alright on a Saturday?"
14:02:41  book(09:20) → ???
```

**It widens the read-to-write gap from milliseconds to the length of a conversation.** In a booking form, availability and booking are one submit. In an agent, a human is talking in between, and forty seconds is an eternity for a contended Saturday slot.

Everything else here is engineering the model neither helps nor hinders.

---

## Idempotency

The single most important property of a write tool: a retry, a duplicate model call, or a user double-submit must not create two bookings.

### The key comes from intent

| Derived from | Result |
|---|---|
| A timestamp or random value | Always different → **no protection at all** |
| The arguments alone | A member legitimately booking the same slot twice (after cancelling) **collides** |
| **session + step + tool** ✓ | One intent, however many times it is sent |

Two properties that pull against each other, and both are required: two genuinely different bookings must get **different** keys, and one booking retried must get the **same** one.

### Three states, and the middle one is the work

```
done      → return the ORIGINAL result. Not a fresh one — the caller
            needs the booking reference that actually exists.
pending   → an attempt started and we never learned how it ended.
            RECONCILE before touching anything.
unknown   → never attempted. Run it.
```

A two-state store (`done` / not) is the obvious implementation and it does not solve the case this exists for. The ambiguous write fails, records nothing, and the retry runs it again.

`pending` is written **before** the call, so a crash between there and the response leaves a fingerprint rather than nothing. On failure it is deliberately **left** pending — forgetting it would licence exactly the replay being prevented.

### Reconciliation, and the trap in it

The tee sheet does not support idempotency keys. Neither does a Google Sheet, and neither will most suppliers when asked. So `pending` is resolved by asking the world whether the operation landed.

**Match on the effect of *this operation*, never on general state.**

```
✗  "is this member booked?"
   A member allowed two live bookings, who already holds Sunday,
   answers YES when the Saturday write failed. You then tell them
   they are on the sheet for Saturday. They find out on Saturday.

✓  "is there a booking for THIS member and THIS slot?"
```

The distinction generalises: **an idempotency key identifies an operation, and operations are unique. State identifies an outcome, and outcomes are ambiguous.** Reconciliation is the weaker fallback you use when the server cannot recognise the key, and it is only safe if the thing you look for is specific enough to identify one operation.

---

## The retry policy is a table, not a judgement

| Failure | Retry? | Safe without idempotency? |
|---|---|---|
| Timeout / network | yes | **no** |
| 429 rate limit | yes, respect `Retry-After` | yes |
| 5xx | yes, ×3 jittered | **no** |
| 4xx validation | **no** | — |
| 409 conflict | **no** | — |
| 401 / 403 auth | **no** | — |

Two rules do most of the work.

**Never retry a 4xx.** The request was wrong; sending it again will still be wrong, and all you have achieved is turning one error into a rate limit. A 4xx is also a fact about the request rather than the network, so it does not count against the circuit breaker.

**The `safeWithoutIdempotency` column is the difference between a reliable client and a double-booking machine.** A GET can always be retried. A *write* that timed out cannot — you do not know whether it landed. Our client stops and hands the ambiguity upward rather than guessing:

```
network — write may or may not have landed, and this call is not idempotent
```

**Jitter is not decoration.** Without it every client retries in lockstep and you have rebuilt the thundering herd you were trying to avoid.

---

## Holds close the gap

Three ways to handle the read-to-write race, in order of preference:

1. **Hold / reserve** — for anything scarce
2. **Conditional write** — send the version you read; the server rejects if it changed. Turns silent corruption into a clean error.
3. **Optimistic** — try it, handle the conflict conversationally. Fine at low contention.

A hold works by **making the read into a write**: you stop asking *"is 09:20 free?"* and start saying *"I'm taking 09:20, briefly."* There is no gap left to race in.

### Expiry beats rollback

The hold expires in five minutes. When a conversation dies halfway — tab closed, connection dropped, agent errored — **nothing needs to happen.** No cleanup code, no path to reach it, no handling for that cleanup itself failing.

> The best compensating action is the one you never have to write.

Five minutes was chosen against measured data: the day-7 harness put conversations at **4 turns median**, so five minutes is generous without being greedy. The cost of holding a slot ninety seconds too long is far smaller than the cost of taking one away mid-sentence.

Better still, the hold **refreshes on every turn**. A member still talking is direct evidence they are still engaged, so the hold lapses only on real silence — which turns "5 minutes" from a guess about conversation length into "5 minutes of silence".

### A conflict is a conversation

When the hold fails because someone got there first, that is not an exception to throw:

> *"Someone's just taken 09:20 — I can do 09:30 or 09:50, both still free."*

Same reframe as escalation in the PRD. **The failure path is a product surface.** Design it as an exception and you will ship a stack trace where a sentence belonged.

And on expiry specifically: only surface what actually changed. If the slot is still free, re-acquire silently. Announcing *"your hold has expired"* when nothing is different alarms a member about your infrastructure.

---

## Ordering is the design

`book_tee_time` is **one tool to the model** and four calls underneath:

| | Step | Reversibility |
|---|---|---|
| 1 | `hold_slot` | Reversible — and expires on its own |
| 2 | check allowance | A read. Reverses by doing nothing. |
| 3 | `confirm_booking` | **Irreversible** |
| 4 | confirmation email | **Un-sendable** — therefore last of all |

**Reversible and cheap first; irreversible last; the thing you cannot un-send last of all.**

The hold comes before the cheaper allowance check, which looks backwards. The reason: the **slot** is the contended resource and the allowance is not. Grab the scarce thing first, then validate the uncontended things while holding it.

### Why the model sees one tool

> Never expose a four-step saga as four tools and hope the model sequences them and cleans up after a failure. It will not — and when it does not, you get a slot held forever, or a fee charged with no booking attached.

The model proposes **one intent**. Code owns the whole transaction, which also means the orchestration is testable without a model in the loop — all twelve reliability checks run with no API calls.

What it costs: the model cannot recover creatively from a partial failure, because it never sees one. That is the trade, and it is the right way round — creative recovery from a half-completed booking is precisely what you do not want.

---

## What was measured

A real HTTP server, deliberately hostile, with failures switchable at runtime so the tests are deterministic rather than probabilistic.

| Test | Result |
|---|---|
| Same key twice | One booking; the retry returns the **first** booking's reference |
| Two members, one slot, concurrently | Exactly one booking; the loser gets `slot_taken` with three alternatives |
| API commits **then** returns 500 | Caller sees an error, the booking **did** land, key left `pending`, retry reconciles, still one booking |
| **Control: same failure, key discarded** | **Two bookings** |

The control matters more than the other three. **A test that still passes when you remove the mechanism is testing nothing.**

---

## Degraded mode

When the tee sheet is unavailable:

1. Booking returns an **outcome**, not an exception — a member gets a sentence they can act on
2. Repeated attempts **trip the circuit breaker** rather than hammering a dead host. Fail fast; stop making someone else's outage worse.
3. **Knowledge keeps working**, because it has no dependency on the tee sheet

That third point was not designed for resilience. It fell out of the day-9 structured/unstructured split, and turned out to be worth something else entirely: the agent degrades to *"I can answer questions but not book"* rather than to *nothing*.

### The mistake made while writing this

The first degraded-mode demonstration **crashed**. The tee-sheet calls were carefully wrapped; the knowledge call was not, and when the model API returned 402 the whole script fell over.

> Degraded mode has to cover **every** dependency, not just the one you were thinking about.

This agent has two — the tee sheet and the model — and designing for the first while forgetting the second is exactly the failure the exercise is about.

---

## The golf club's actual situation

The tee sheet is a **Google Sheet**. It has no idempotency, no transactions, no row locking, and staff edit it directly all day.

| Property | Available? | What we do |
|---|---|---|
| Idempotency keys | ✗ | Client-side store + reconciliation |
| Transactions | ✗ | Order steps so only the last is irreversible |
| Row locking | ✗ | Holds, as an append |
| Exclusive writers | ✗ **and never will be** | Single-threaded worker applying a request log (PRD §5) |

The last row is the one that cannot be engineered away. Every read is stale the instant it happens, because a member phones and someone opens the sheet.

**A hold is an append**, and appending is the one operation a spreadsheet performs safely — no read, no race. That is why the PRD's request-log design and this day's hold pattern are the same idea.

---

## Known gaps

**Internal diagnostics can reach a member.** The `unavailable` outcome carries `reason: "network — write may or may not have landed, and this call is not idempotent"`. That is a message for an engineer sitting in a field a member-facing layer might print. Internal and member-facing text want separating.

**Reconciliation is best-effort and can itself fail.** If the reconciling read times out, we are back where we started with one more layer of uncertainty. There is no fix on our side — only the server recognising the key would close it, which is a supplier conversation rather than an engineering one.

**No dead-letter handling for stuck keys.** A key left `pending` that never gets retried is invisible. `pending()` exists so ops can list them; nothing yet acts on the list.

**The circuit breaker is process-local.** Multiple instances each maintain their own, so a dead host gets N× the failing traffic before any of them gives up.

---

## When not to do this

If every write is reversible and uncontended, most of this is overhead. The machinery exists because a tee slot is **scarce** (so it needs holds) and a booking is **irreversible in practice** (so it needs idempotency).

An agent that only reads needs a timeout and a circuit breaker, and nothing else on this page.
