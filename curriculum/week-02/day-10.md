# Day 10 — Business Tools

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can design and implement tools that write to real business systems safely — handling partial failure, concurrency, and retries — and you understand why this, not the model, is where enterprise agent projects actually fail.

---

## Concepts

### The step change from day 3

Day 3 tools were single calls against a local database. Real business tools are:

- **Remote** — they fail, time out, and rate-limit
- **Stateful** — the world changed between your read and your write
- **Concurrent** — two members want the same 09:20 slot
- **Multi-step** — a booking is check + hold + confirm, and it can fail in the middle
- **Owned by someone else** — you don't control the API, its uptime, or its semantics

The model is the easy part. **This is where the project is won or lost**, and it is the part that AI-agent discourse almost entirely ignores.

### Idempotency

The single most important property of a write tool.

A retry, a duplicate model call, or a user double-submit must not create two bookings. The mechanism:

```ts
const key = `${sessionId}:${stepIndex}:${toolName}`;

// Before: has this exact operation already run?
const prior = await idempotencyStore.get(key);
if (prior) return prior.result;      // return the ORIGINAL result, not a new one

const result = await api.createBooking(args);
await idempotencyStore.set(key, result);
return result;
```

The key must be derived from the *intent*, not from a timestamp or a random value. Two independent bookings by the same member must have different keys; one booking retried must have the same one.

If the downstream API supports idempotency keys natively, pass yours through. If it doesn't, that is a risk to name in your architecture doc.

### The read-then-write race

The classic agent bug:

```
14:02:01  agent A: check_availability(Sat 09:20) → available
14:02:04  agent B: check_availability(Sat 09:20) → available
14:02:07  agent A: book(Sat 09:20) → OK
14:02:11  agent B: book(Sat 09:20) → ???
```

The gap between read and write is huge in an agent, because a human is talking in between. Ten seconds of conversation is an eternity for a contended resource.

Three fixes, in order of preference:

1. **Hold/reserve pattern** — `hold_slot` creates a short-lived reservation (2 minutes), `confirm_booking` converts it. The right answer for anything scarce.
2. **Conditional write** — pass the version or state you read; the server rejects if it changed. Cheap, and it turns a silent corruption into a clean error.
3. **Optimistic + graceful failure** — just try it, and handle the conflict as a normal conversational outcome. Fine for low contention.

A conflict is **not an exception**. It is a conversation: *"Someone just took 09:20 — I can offer 09:30 or 09:50."* Design the recovery, don't just throw.

### Multi-step operations and compensation

A booking might be: reserve slot → charge guest fee → add to competition → send confirmation. If step 3 fails, steps 1 and 2 already happened.

You have no distributed transaction. You have **compensating actions**:

| Step | Compensation |
|---|---|
| `hold_slot` | `release_slot` (or let it expire — prefer this) |
| `charge_guest_fee` | `refund_guest_fee` |
| `add_to_competition` | `remove_from_competition` |

Rules that keep you sane:

- **Order steps so the reversible and cheap ones come first, and the irreversible one comes last.** Charge money last. Send the email last of all — you cannot un-send it.
- **Prefer expiry over explicit rollback.** A hold that times out needs no compensation logic and no failure path of its own.
- **Make the whole operation one tool from the model's perspective.** The model should call `book_tee_time`; the orchestration and compensation are your code's problem. Never expose a three-step saga as three tools and hope the model sequences them and cleans up — it will not.

That last point is the day's most useful design rule.

### Failure taxonomy

Each failure type needs a different response. Encode this, don't improvise it:

| Failure | Retry? | Tell the model | Tell the user |
|---|---|---|---|
| Timeout | Yes, with backoff | After exhaustion | "Taking longer than usual" |
| 429 rate limit | Yes, respect `Retry-After` | If persistent | Usually nothing |
| 5xx | Yes, ×3, jittered backoff | Yes | "System unavailable, try shortly" |
| 4xx validation | **No** | Yes — with the specific field | Ask for correction |
| 409 conflict | **No** | Yes | Offer alternatives |
| Auth failure | **No** | Yes | Escalate — this is an ops problem |
| Unknown | No | Yes | Escalate |

**Never retry a 4xx.** Retrying a bad request is how you turn one error into a rate limit.

And critically: **an ambiguous timeout on a write is the hard case.** Did it succeed? You don't know. This is exactly what idempotency keys are for — retry with the same key and find out safely.

### Degraded mode

When the tee-sheet API is down, the agent should not die. It should degrade: still answer knowledge questions, still take the request and queue it, still tell the truth about what it can't do right now. Design the degraded behaviour explicitly — it will be exercised.

---

## Architecture

```
   Model proposes  book_tee_time(...)
          │
          ▼
   ┌───────────────────────────────────────────┐
   │            Tool Orchestrator              │
   │  idempotency check ──▶ cached? return it  │
   │  policy check (day 6)                     │
   │  ┌─────────────────────────────────────┐  │
   │  │ 1. hold_slot        (expires 2 min) │  │
   │  │ 2. validate member allowance        │  │
   │  │ 3. confirm_booking                  │  │
   │  │ 4. queue confirmation email  ← last │  │
   │  └─────────────────────────────────────┘  │
   │  on failure → compensate in reverse       │
   │  record idempotency result + audit        │
   └────────────────┬──────────────────────────┘
                    ▼
     ┌──────────────────────────────┐
     │  API client layer            │
     │  timeout · retry+backoff ·   │
     │  circuit breaker · Zod parse │
     └──────────────────────────────┘
```

**Never trust an external API's response shape.** Zod-parse it. When the supplier changes a field, you want a clear validation error, not a `undefined` propagating into a booking confirmation.

**Circuit breaker:** after N consecutive failures, stop calling and fail fast for 30 seconds. Protects you and them, and turns a slow cascading failure into a clean degraded mode.

---

## Exercise

**1. Build a fake tee-sheet API** as a separate local HTTP service — not an in-process function. You need the network in the loop to learn anything. Give it: slot availability, holds with expiry, bookings, member allowances.

**2. Make it hostile, via config flags:** `--latency 3000`, `--error-rate 0.2`, `--timeout-rate 0.1`, `--flaky-writes` (returns 500 *after* committing). That last one is the ambiguous-write case and it is the one worth engineering against.

**3. Build the API client layer:** timeouts, retries with jittered exponential backoff, the retry policy table above, Zod response parsing, circuit breaker.

**4. Implement the tool inventory:**

| Tool | Kind | Notes |
|---|---|---|
| `check_availability` | read | Date + time window |
| `hold_slot` | write | Expiring reservation |
| `confirm_booking` | write | **Idempotent** |
| `cancel_booking` | write | Idempotent; policy-checked |
| `get_member_allowance` | read | Guest limits |
| `list_competitions` | read | |
| `enter_competition` | write | Handicap eligibility |

**5. Implement `book_tee_time` as one orchestrated tool** with compensation. The model sees one tool.

**6. Add idempotency** with a persistent store. Then prove it: run the same booking twice with the same key and assert one booking exists.

**7. Force the race.** Two concurrent sessions booking the same slot. Both must terminate correctly, exactly one booking must exist, and the loser must get a *useful conversational outcome*, not a stack trace.

**8. Test the ambiguous write.** Turn on `--flaky-writes`. The API commits then returns 500. Your retry must not double-book. If it does, fix it and re-test — this is the exercise's core.

**9. Implement degraded mode.** Kill the tee-sheet API mid-conversation. The agent should stay useful and honest.

**10. Write the failure table** in your journal: every failure you injected, what the code did, what the user saw.

---

## Deliverable

- [ ] Standalone fake API with configurable hostility
- [ ] Client layer: timeout, retry policy, backoff, circuit breaker, Zod parsing
- [ ] Seven tools, correctly tagged read/write
- [ ] `book_tee_time` orchestrated with compensation, exposed as one tool
- [ ] Idempotency with a proving test
- [ ] Concurrency race test — exactly one booking
- [ ] Ambiguous-write test — no double booking
- [ ] Degraded mode
- [ ] `docs/architecture/tool-reliability.md`
- [ ] `journal/day-10.md` — failure injection table

---

## Reflection

1. What is your idempotency key derived from? Give a case where your scheme produces a *wrong* collision, and one where it wrongly misses.
2. In the race, what did the losing member experience? Would you be happy receiving that message?
3. Why order the steps reversible-first, irreversible-last? Which of your steps is genuinely un-compensatable?
4. `book_tee_time` is one tool to the model but four calls underneath. What did that buy you? What did it cost?
5. The tee-sheet API has no idempotency support and the supplier won't add it. What do you do?

---

## Interview Question

> "Your agent books appointments through a third-party API. It's flaky. How do you make this reliable?"

The dividing line is whether they mention idempotency unprompted. Strong answers: idempotency keys derived from intent, with the ambiguous-timeout case called out explicitly; hold/reserve for contended resources; retry only what's retryable, with backoff; circuit breaker and degraded mode; compensation ordered so the irreversible step is last; the orchestration hidden behind one tool so the model isn't responsible for consistency; conflicts handled as conversation rather than error; and validating the supplier's response shape. The deepest answers note that this is ordinary distributed-systems engineering and that the LLM changes almost nothing about it — except by widening the read-to-write gap, because a human is talking in the middle.

---

**Next:** [Day 11 — Memory](day-11.md)
