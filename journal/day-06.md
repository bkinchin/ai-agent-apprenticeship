# Day 6 — Policies and Guardrails

**Project:** 01-hello-agent · **Commits:** `9075b3e` → `1731487` (13 commits)

The longest day, and most of it came from sitting down and talking to the thing.

---

## The audit that started it

Eleven rules, four files, all TypeScript. Several owned by people who cannot read TypeScript:

| Rule | Lives in | Owned by |
|---|---|---|
| Must verify before seeing account details | `canTransition` | **Data protection** |
| Must confirm before executing | `canTransition` | **Legal** |
| A request for a human is honoured immediately | a regex | **Customer service** |

And nowhere to look them up. *"What are the rules for this agent?"* → read three files and know what you're looking for.

## Where I pushed back, and was right

I challenged the "put it in YAML so marketing can edit it" argument. Marketing won't edit YAML — they'll brief a product person, and it's still a ticket and a deploy. **Consolidation and externalisation are different decisions**, and consolidation was doing most of the work claimed for YAML.

The honest reasons to externalise are narrower:

1. **Reading is not writing.** A compliance reviewer needs to read the rules, never to edit them.
2. **Audit.** *"What were the rules on 14 July?"*
3. **It can be generated** — week 3's Agent Factory can safely emit validated *data*, never TypeScript.

I also raised: an agent that can edit the policies marketing is allowed to change. That's the right shape, and it forced a split:

```
shared/policies/
├── safety-baseline.yaml    Head of Security.     NOT editable by automation.
└── commercial.yaml         Head of Customer Ops. Editable with approval.
```

Safety rules are concatenated first and evaluation denies on first match, so commercial rules can only **add** constraints. A property of the ordering, not of anyone remembering.

> **Never let an automated system edit the rules that constrain it.**

## The gate

The tool implementations are a **module-private** record in `executor.ts`. There is no exported function that runs a tool without passing:

```
exists? → schema (day 4) → policy (day 6) → execute → audit
```

Denials are audited too, with rule id, tier and policy version. An audit log of only successful actions says nothing about what the controls prevented.

**Then I asked whether the leftover `agent.ts` was dead scaffolding or a real bug.** Two commands settled it:

```bash
grep -c "policy\|evaluate" src/agent.ts     # → 0
grep -n "name: \"" src/agent.ts             # → find_customer, verify_customer
```

It had its own tool implementations, zero policy checks, and still contained the enumeration hole fixed an hour earlier. **The "structural" guarantee was false** — two paths to the tools, one ungated. `agent.ts` lost 90 lines.

> Dead code nobody reads is clutter. Dead code that looks authoritative is a liability.

## Account enumeration

`find_customer` told any stranger whether an email belonged to a customer, and named them. Gating it behind verification is circular — verification needs something to verify against.

The fix was a **tool redesign, not a policy rule**: one `verify_identity(email, dob)` with a single failure path.

```ts
if (!c || c.dob !== dateOfBirth) return VERIFY_FAILED;
```

A wrong date and a non-existent account return the **same bytes**. Tested for byte-identity, because that's the property that breaks the first time someone adds a helpful "did you mean?".

`find_customer` doesn't return less now. **It doesn't exist.**

## Three bugs from one ordinary conversation

Typed *"3 proceed with cancellation"*. Nothing happened. `/state` showed no `confirmedAction`.

The confirmation check was `/^(yes|yeah|confirm|do it|go ahead)/i` — a prefix-anchored regex. I'd identified on day 5 that confirmation was the hard case, then implemented the naive version of exactly that.

Three problems, none of which **51 passing tests** could see:

1. Regex missed natural consent → the flow could never complete
2. The agent could be escalated *to* but couldn't escalate *itself* — it promised a handoff, then retracted it
3. `advance()` ran *after* the model call, so a recorded confirmation didn't unlock `EXECUTION` until the turn after

## Calibrating instead of arguing

I asked: force "yes"/"no", or infer with an LLM? Answered with data — 19 phrasings labelled **before** seeing the model's answers:

| | |
|---|---|
| Agreement | **18/19** |
| `"yes, apply the discount"` | correctly **not** consent to cancellation |
| Only disagreement | `"ok"` — arguably my label was wrong |

That fourth row is the argument. A regex matching "yes" would have cancelled a subscription when the customer agreed to a **discount**.

The `"ok"` disagreement isn't a defect — it's a policy question: *how strong must consent be for an irreversible action?* An owner's call.

## Two things I flagged that turned into fixes

**"The agent keeps talking about colleagues it'll pass me to."** Root cause: the tools array is a **capability list, not a description of the flow**. Given only a snapshot, the model infers *"can't do X now"* = *"can never do X"*, and invents a colleague. Fixed by describing the process in the system prompt — which costs nothing in security, because capability is still enforced by the array.

> Prompts are the wrong tool for enforcement and the right one for explanation.

**"A user should have to clearly reject the retention offer before confirming cancellation."** `retentionOffered` recorded that the *tool ran*, not that the customer *weighed it*. Fixing it found a second problem: **`offer_retention` presented a discount with no tool to accept one.** We were offering people 50% off and couldn't have applied it.

Third instance this week of the same pattern:

| Flag | Recorded | Should have recorded |
|---|---|---|
| `executedAction` | reached the last stage | the cancellation happened |
| `retentionOffered` | the tool ran | the customer weighed it |
| `confirmedAction` | the word "yes" appeared | consent to *this* action |

Then adding the branch broke `advance()` — a linear next-stage map can't express *decline → CONFIRMATION, accept → COMPLETE*.

## Escalation, measured

The customer-asks-for-a-human hatch was still a regex, guarding the **highest-cost-if-missed** trigger with the weakest mechanism.

| | Score |
|---|---|
| Regex | **6/16** — missed "put me through to someone"; fired on "are you a human?" |
| Reused confirmation classifier | 14/16 |
| Purpose-built classifier | **16/16** |

Reusing `checkConfirmation` scored 14/16 with both misses on indirect phrasing. Confirmation asks *"do you agree to X?"*; escalation asks *"are you asking for X?"* **Different question shapes need different prompts.**

## My design call, and what it needed

I preferred the observed behaviour — frustrated customer straight through, neutral request gets one offer to help. Better than my mentor's blanket "always immediate".

But it was **accidental** — emergent from the model's judgement, so it varied by phrasing and would drift. Turned into a rule:

```
frustrated            → straight through, no model call
neutral, first ask    → agent may offer to help once
neutral, asked again  → straight through
```

The third line is the safeguard I hadn't specified. Left to itself the model keeps offering to help a politely persistent customer.

> Observed cases tell you the branches. You have to work out the terminating condition yourself.

## The honest summary of the week

**51 tests passed through every bug found today.** Every one was correct and checking something real. The system was still unusable for an actual customer.

Unit tests verify the parts. They cannot tell you the machine is a trap — that only appears when someone walks through it saying human things like *"3 proceed with cancellation"*.

## State at the end

| | |
|---|---|
| Tests | 55, no API key, under a second |
| Calibrated classifiers | confirmation 18/19, escalation 16/16 |
| Uncalibrated | retention decline (reuses the confirmation prompt) |
| Still a regex | "wrong account" — **2/8** on realistic phrasings |

That last line is a known, accepted gap: a miss is mild (the customer restates it) rather than harmful. Recorded rather than fixed.

---

## Reflection

*(your notes)*
