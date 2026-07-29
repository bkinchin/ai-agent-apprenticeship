# shared/policies

Policy schema, engine, and the policy sets themselves.

## Why policies live here and not in projects

They are reviewed by business owners, versioned independently of code, reused across agents, and consumed by the [Agent Factory](../../projects/04-agent-factory/). A YAML file can be read by compliance; your `if` statements cannot.

## The principle

**A prompt is not a control.**

"Never issue a refund over £100" in a system prompt is a request. It survives most conversations and fails on the unusual one, the long one, or the adversarial one — and it may stop working entirely on the next model version.

If breaking a rule costs money, breaks a regulation, or ends up in a newspaper, it is enforced in code at the action boundary, on a path the model cannot influence.

## Enforcement points

| Point | Catches |
|---|---|
| Input | Injection, PII, abuse, out-of-scope |
| **Action** | **Unauthorised or over-limit actions — the one that matters** |
| Output | Leaked data, bad promises, wrong tone |

Action-level enforcement is last before the world changes, and it is the only point the model cannot talk its way around, because it does not involve the model.

## Rule shape

```yaml
- id: goodwill-cap
  type: limit                    # authorisation | limit | sequencing |
  tool: issue_goodwill_credit    # disclosure | conduct | regulatory | scope
  max: { amount: 50, currency: GBP }
  on_exceed: escalate
  message: "Credits above £50 need a manager."
```

## Non-negotiables

- **Fail closed.** Error, ambiguity, or missing data → deny and escalate.
- **Version everything.** Every agent action is stamped with the policy version in force. Never edit a version in place.
- **Every rule has a rationale.** If you cannot state why it exists, question the rule.
- **Every rule has three tests:** compliant, violating, and violating under user pressure.
- **A denial is a conversation, not an error.** The customer gets an explanation.

## Files

```
policies/
├── schema.ts               # Zod schema for policy documents
├── engine.ts               # pure function: (action, context) -> decision
├── cancellation.yaml       # day 6
├── booking.yaml            # day 10
├── escalation.yaml         # day 12
└── safety-baseline.yaml    # day 17 — NOT generatable, cannot be overridden
```

> **Populated from:** days 6, 12, 17
