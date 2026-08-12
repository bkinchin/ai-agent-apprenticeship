# Day 10 — Business Tools

**Project:** 03-golf-club-agent · **Deliverable:** hostile fake API, client layer, seven tools, one orchestrated tool, twelve reliability checks

The day the curriculum says is where enterprise agent projects actually fail. It is also the day with the least to do with the model — almost everything here would be required for any automation touching a booking system.

The LLM changes exactly one thing, and it changes it a lot: **it widens the read-to-write gap from milliseconds to the length of a conversation.**

---

## Failure injection table

Every failure injected, what the code did, what a member would see.

| Injected | What the code did | What the member sees |
|---|---|---|
| **Slot already held** (409) | No retry — a 409 is a fact about the request. Fetched the nearest free slots. | *"Someone's just taken 09:20 — I can do 09:00, 09:10 or 09:30."* |
| **Two members, one slot, concurrent** | The hold rejected the second. Exactly one booking exists. | Winner: booked. Loser: alternatives, in time order. |
| **Write commits, then returns 500** | Key left `pending`. Retry reconciled against the world, found the orphaned booking, returned it. | One booking, one reference. No sign anything went wrong. |
| **Same key sent twice** | Returned the **original** result rather than running again. | One booking, one reference. |
| **Network unreachable** on a write | Refused to retry — the write may have landed and the call is not idempotent. Handed the ambiguity upward. | *"I can't reach the booking system — I'd give the pro shop a ring."* |
| **5 consecutive failures** | Circuit opened for 30s; subsequent calls failed instantly without touching the host. | Same message, immediately, instead of after three timeouts each. |
| **Response shape changed** | Zod rejected it at the boundary with a named field. | Never reached the member. |
| **Model API returned 402** | *(First version: crashed the whole script.)* Now degrades. | *"Both systems are down — here's who to call."* |
| **Hold expires mid-conversation** | Refreshed on every turn; lapses only on real silence. | Nothing, unless someone actually took the slot. |

---

## Twelve checks, and the one that matters

```
1. idempotency        one booking; the retry returns the FIRST reference
2. the race           exactly one booking; loser gets three alternatives
3. ambiguous write    caller saw an error, the booking DID land,
                      key left pending, retry reconciled, still one booking
4. CONTROL            same failure with the key discarded → TWO bookings
```

Check 4 is worth more than the other three together. **A test that still passes when you remove the mechanism is testing nothing** — and I would not have known the first three were real without it.

All twelve run with **no model calls at all**, because the orchestration is code. That is what putting the saga behind one tool bought.

---

## Two corrections I had to make

### The idempotency store was wrong the first time

My first version had two states — recorded or not — and recorded only on **success**. Which means the ambiguous write fails, records nothing, and the retry runs it again. That is the exact case the day exists for, and I had written a comment excusing it rather than solving it.

The working version needs three states, and the middle one is the whole job:

```
done      return the ORIGINAL result
pending   an attempt started and we never learned how it ended → RECONCILE
unknown   never attempted → run it
```

`pending` written **before** the call, and deliberately **left** there on failure. Forgetting it would licence the replay being prevented.

### The alternatives were useless

Found by answering reflection question 2 rather than by any test:

```ts
const { slots } = await checkAvailability(date, "00:00", "23:59");
return { alternatives: slots.slice(0, 3) };   // the earliest three of the DAY
```

Ask for 09:20, get offered 07:00, 07:10 and 07:20. That is not an alternative, it is a different plan. Now sorted by proximity to the requested time and presented in time order: **09:00, 09:10, 09:30**.

Every assertion passed on the broken version, because they checked *"were alternatives offered?"* and not *"would a member want these?"*

---

## Reflection

**1. What is the idempotency key derived from? Where does it wrongly collide, and where does it wrongly miss?**

`sessionId : step : tool`.

**Wrong collision** — a member books a slot, cancels it, and books the *same* slot again within one session. If the step index does not advance, the second booking gets the same key and returns the **cancelled** booking's reference. They are told they hold a slot that no longer exists. The mitigation is that `step` must come from a monotonic counter over tool calls, never from anything that resets.

**Wrong miss** — the session identity is not stable. If the process restarts, the connection drops and reconnects, or the member returns on a different device, a new `sessionId` is generated and the retry gets a different key. **No protection at all**, and this is the more likely of the two.

Which points at a better scheme: derive the key from something the *conversation* owns rather than something the *transport* owns — a request id generated once when the member expresses the intent, and carried in conversation state. Not implemented; recorded as a gap.

**2. In the race, what did the losing member experience? Would you be happy receiving it?**

`slot_taken` with three alternatives — and no, I would not have been happy with the first version, which is how the bug above got found. **09:00, 09:10, 09:30** for a member who asked for 09:20 is a genuinely useful message. Three of the earliest slots on a fourteen-hour day is not.

What is still missing: it does not say **why**. *"Someone's just taken it"* is more use than *"that's not available"*, because it tells the member this was bad luck and seconds ago, not a rule they have fallen foul of.

**3. Why reversible-first, irreversible-last? Which step is genuinely un-compensatable?**

So that a failure at step *n* costs only what steps 1..*n*−1 can give back. Fail at the allowance check and you have spent a hold that expires by itself; fail after the charge and you owe a refund.

The genuinely un-compensatable step is **the confirmation email**. A refund reverses a charge and a cancellation reverses a booking, but nothing un-sends an email. Which is exactly why it is last.

There is a second un-compensatable thing that is not in the list: **the member's expectation.** Once you have said *"you're booked"*, "sorry, actually no" is a trust cost no compensating action reverses. That is an argument for the confirmation coming from the record rather than from the agent — the PRD's day-8 finding, arriving here as a reliability requirement rather than an accuracy one.

**4. `book_tee_time` is one tool to the model and four calls underneath. What did that buy, and what did it cost?**

**Bought:**
- Consistency the model cannot break. It never sees a half-completed booking, so it cannot improvise a recovery.
- Testability. Twelve reliability checks, no model calls.
- Compensation that actually runs, because it is in a `catch` block rather than in a hope.

**Cost:**
- The model cannot recover creatively from a partial failure — which is the right way round. Creative recovery from a half-completed booking is precisely what nobody wants.
- **Less to say.** The model does not know a hold is outstanding, so it cannot tell the member *"I've got that held for five minutes while you decide."* That is genuinely useful information, and the fix is to return it in the tool result rather than to expose the step.

**5. The API has no idempotency support and the supplier will not add it. What do you do?**

Exactly what this project does, because that is the situation — the tee sheet is a Google Sheet:

1. **A client-side store**, persisted, with the three states above.
2. **Reconciliation** on `pending` — go and ask whether it landed. Matching on the effect of *this* operation (this member, this slot), never on general state.
3. **Write down what is left.** Reconciliation can itself time out. The circuit breaker is process-local. A key stuck at `pending` that nobody retries is invisible. None of these is fixable on our side; only the server recognising the key would close them, which is a supplier conversation rather than an engineering one.

The honest summary is that you get most of the protection and you should say so, rather than claiming the problem is solved.

---

## The mistake that taught the most

The degraded-mode demonstration **crashed**. I wrapped every tee-sheet call carefully and left the knowledge call bare; the model API returned 402 and the whole script fell over.

> Degraded mode has to cover **every** dependency, not just the one you were thinking about.

This agent has two — the tee sheet and the model. I designed for the first and forgot the second, while writing the exercise about exactly that.

The fixed version is a better demonstration than the one intended, because both dependencies really were down and it still produced an honest handover.

---

## What day 10 was actually about

Nothing here required a model, and that is the point. The agent is one caller among many that this booking system will have, and it needs the same engineering any of them would.

What the LLM contributed was a **forty-second gap between reading availability and writing a booking**, because a human was talking. Everything else — idempotency, backoff, breakers, compensation, degraded mode — is what you would build for a mobile app on a bad connection.
