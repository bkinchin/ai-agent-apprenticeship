# Day 12 — Human Escalation

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can design escalation as a product surface — with defined triggers, useful handoff context, and a measurable feedback loop — rather than as an error path.

---

## Concepts

### Escalation is the feature, not the failure

The instinct is to treat a handoff as the agent losing. That instinct produces bad systems: agents that persist past their competence, frustrate customers, and take three wrong actions before someone notices.

Reframe it: **the agent's job is to resolve what it can resolve and route everything else quickly and with context.** A fast, well-informed handoff is a *good* outcome. A slow, context-free handoff after five failed attempts is the bad one.

Note also that a **zero escalation rate is a red flag**, not a triumph — it means the agent is attempting things it shouldn't.

### Trigger taxonomy

Escalation has four sources. Only the second is "failure".

| Source | Example | Detection |
|---|---|---|
| **Policy** | Annual contract, immediate cancellation | Deterministic — day 6 |
| **Capability** | Question outside knowledge and tools | Model-signalled, in-band |
| **Emotional** | Anger, distress, vulnerability | Classifier + keywords |
| **Requested** | "Get me a person" | Keyword + intent — **always honour** |

The first is code and is the most reliable. The fourth must be honoured **immediately and without negotiation** — an agent that resists a request for a human generates complaints far out of proportion to its accuracy.

Additional structural triggers worth implementing:

- **Loop detection** — same tool, same args, 3× → escalate
- **Step limit** — hit `MAX_STEPS` → escalate, don't just stop
- **Repeated failure** — the member has rephrased 3 times → escalate
- **Low confidence on a high-stakes action** → escalate
- **Vulnerability signals** — bereavement, illness, financial distress. Escalate immediately and never attempt to handle these. This is both an ethical and a regulatory requirement in many sectors.

### In-band signalling

The model needs a *typed* way to say "I can't do this" — same pattern as days 4 and 9:

```ts
z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("resolved"), summary: z.string() }),
  z.object({
    outcome: z.literal("escalate"),
    reason: z.enum(["out_of_scope","policy","customer_request",
                    "emotional","repeated_failure","low_confidence"]),
    urgency: z.enum(["standard","high","immediate"]),
    summary: z.string(),
    attempted: z.array(z.string()),
    suggestedTeam: z.enum(["membership","operations","greenkeeping","manager"]),
  }),
])
```

Without this, "I can't help" arrives as prose and your system can't route it. With it, escalation is data — routable, measurable, and testable.

### The handoff package

This is where escalation is usually botched. The human receives "customer needs help" and starts from zero, so the member repeats everything and the agent has made things *worse* than no agent.

A proper handoff contains:

```
ESCALATION · #ESC-2026-0714-0093 · URGENCY: high
────────────────────────────────────────────────
MEMBER    Sarah Chen · M-4471 · Full member since 2019
REASON    Policy — competition entry after handicap cut-off
SUMMARY   Wants to enter Saturday's Medal. Entry closed at
          18:00 yesterday. Believes she entered by phone on
          Tuesday; no record found.
ATTEMPTED · Verified identity ✓
          · Checked competition entries — not present ✓
          · Checked handicap eligibility — eligible ✓
          · Explained the cut-off — member disputes it ✓
NEEDED    Confirm whether a phone entry was taken Tuesday
          (pro shop log) and decide on a discretionary entry.
SENTIMENT Frustrated but civil. Long-standing member.
TRANSCRIPT  [link]
────────────────────────────────────────────────
```

**"ATTEMPTED" and "NEEDED" are the valuable fields.** They save the human 90 seconds each and prevent the member repeating themselves. Design the package for the human's workflow — ask what they need in the first ten seconds.

### The three handoff modes

| Mode | Member experience | Use when |
|---|---|---|
| **Warm** | Live transfer, human joins now | Emotional, urgent, high value |
| **Cold** | "Someone will contact you within 4 hours" | Standard, out of hours |
| **Assisted** | Human reviews the agent's proposed action before it executes | High-stakes writes ← underrated |

**Assisted mode is the most commercially useful and least discussed.** The agent does 95% of the work — gathers, verifies, drafts the action — and a human approves. You get most of the efficiency with a hard safety ceiling. It is often the right first release for anything irreversible, and a good answer in interviews.

### Closing the loop

Escalations are your richest improvement signal. For each one, capture: the trigger, what the human did, whether the agent *could* have handled it, and if not, what was missing — a tool, a knowledge gap, a policy, a model limitation.

Review weekly. Escalation reasons sorted by volume is your roadmap. This is the input to day 19's improvement loop, so build the capture now.

### Reverse handoff

The human resolves the issue — can the agent take back over? Usually yes, and usually valuable. It needs: a summary of what the human did written back into session state, and clear ownership so both aren't responding at once.

---

## Architecture

```
     any stage
         │
    ┌────┴──────────────────────────────────┐
    │        Escalation Detector            │
    │  policy · capability · emotional ·    │
    │  requested · loop · step-limit        │
    └────┬──────────────────────────────────┘
         ▼
   ┌───────────────┐
   │ Build handoff │  context · attempted · needed ·
   │   package     │  sentiment · transcript link
   └───────┬───────┘
           ▼
   ┌───────────────┐        ┌──────────────┐
   │    Router     │───────▶│ Human queue  │
   │ team, urgency │        │ (priority)   │
   └───────┬───────┘        └──────┬───────┘
           ▼                       ▼
   Tell the member             Resolution
   honestly, with an              │
   expectation of when            ▼
                          ┌────────────────┐
                          │ Feedback store │──▶ day 19
                          └────────────────┘
```

**What you say to the member matters as much as the routing.** Never "an error occurred". Say what's happening, why, and when they'll hear back:

> "I can't approve a late competition entry myself — that needs the competition secretary. I've passed on everything we've discussed, including that you believe you entered by phone on Tuesday. They'll come back to you by 4pm today. Reference ESC-2026-0714-0093."

---

## Exercise

**1. Write the escalation policy** in `shared/policies/escalation.yaml`: every trigger, its urgency, its target team, and the member-facing message template.

**2. Implement deterministic triggers:** policy denials that route to escalation, loop detection, step limit, repeated rephrasing.

**3. Implement the in-band signal** with the discriminated union.

**4. Implement request detection.** "Speak to a human", "get me a manager", and 10 paraphrases. **Test that it works from every stage, including mid-booking.** Never negotiate.

**5. Implement emotional and vulnerability detection.** Separate them — vulnerability is immediate and unconditional. Be conservative: false positives cost a handoff, false negatives cost a person.

**6. Build the handoff package generator** with all fields above.

**7. Build a queue and a human console** — a simple CLI is fine. Read the package, resolve, write the resolution back.

**8. Implement assisted mode** for one high-stakes action: the agent proposes, the console shows the exact action with arguments, a human approves or rejects, then it executes. This is the most valuable thing you'll build today.

**9. Implement reverse handoff.**

**10. Add escalation cases to the golden set** — at least 5, covering all four trigger sources — and assert that escalation *happened*, with the right reason and urgency. Under-escalation and over-escalation are both failures.

**11. Role-play 5 escalations end to end.** Be the member, then be the staff member reading the package. **What is missing from the package when you're the human?** Add it.

---

## Deliverable

- [ ] `shared/policies/escalation.yaml`
- [ ] All four trigger sources implemented
- [ ] Loop detection + step-limit escalation
- [ ] Handoff package generator with ATTEMPTED / NEEDED
- [ ] Queue + human console
- [ ] **Assisted mode for one high-stakes action**
- [ ] Reverse handoff
- [ ] 5+ escalation eval cases asserting reason and urgency
- [ ] Feedback capture for day 19
- [ ] `journal/day-12.md` — the role-play findings

---

## Reflection

1. Reading your own handoff package as the staff member — what was missing? Why didn't you anticipate it?
2. What escalation rate would you target for this agent? What does *too low* tell you?
3. Assisted mode: which action did you pick, and what does it cost in human time per transaction? Is that economic?
4. Your emotional classifier has false positives and false negatives. Which do you tune toward, and why?
5. A member is escalated, the human resolves it, and the same member returns next week with the same issue. What should have happened after the first escalation?

---

## Interview Question

> "When should an agent hand off to a human, and what makes a good handoff?"

Signals of depth: escalation as designed product rather than failure; the four trigger sources with policy triggers being deterministic; honouring an explicit request immediately and unconditionally; structural triggers like loop and step-limit detection; the handoff package containing what was *attempted* and what is *needed*; assisted mode as a way to ship high-stakes capability safely; and escalation reasons as the primary improvement signal. The best answers also flag that a very low escalation rate is a warning sign, and that vulnerability detection is a category of its own with no threshold negotiation.

---

**Next:** [Day 13 — Observability](day-13.md)
