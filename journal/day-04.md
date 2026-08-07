# Day 4 — Structured Outputs

**Project:** 01-hello-agent · **Commits:** `2e49e1b`, `03a5367`

---

## The hole

Every tool handler had a line like this:

```ts
const { email } = input as { email: string };
```

`as` is a claim, not a check. **TypeScript's types are erased before the code runs.** Five malformed inputs, typecheck clean, all five passed:

```
{"email":"billy@example.com"}   →  billy@example.com   ✓
{"email":12345}                 →  12345               ← a number, typed as string
{"emial":"billy@..."}           →  undefined
{}                              →  undefined
"billy@example.com"             →  undefined
```

> TypeScript protects you from yourself. It cannot protect you from the outside world.

Four boundaries had this: tool arguments (**the model** — the worst, because it produces *plausible* wrong data), SQLite rows, `process.argv`.

## The fix

A Zod schema is an **object that exists at runtime** — not a type. Same five inputs:

```
✓  {"email":"billy@example.com"}
✗  {"email":12345}          Invalid input: expected string, received number
✗  {"emial":"..."}          expected string, received undefined
✗  {}                       expected string, received undefined
✗  "billy@example.com"      expected object, received string
```

Gate at the top of `execute()`; nothing below it runs on unchecked data. And a denial returns a **sentence** the model reads and corrects itself from — validation as a conversation, not a wall.

## One definition, three uses

The shape was written twice — once as `input_schema` for the model, once as an `as`. Generating the first from the Zod schema removed the drift *and* measurably improved behaviour:

| | hand-written `"type": "string"` | generated from Zod |
|---|---|---|
| Model sends `billy@example` | gate rejects → model apologises and asks | **model doesn't try** — asks the customer |
| API calls | 2 | **1** |

`z.toJSONSchema()` emitted `"format": "email"` and a pattern — things I'd never told the model. Telling it the real rule stopped it guessing.

> Two layers: the schema sent to the model makes the right thing *likely*; the check in code makes the wrong thing *impossible*. Neither substitutes for the other.

## Enums

Same three customers, one field changed:

| Customer said | `z.string()` | `z.enum([...])` |
|---|---|---|
| "way too expensive" | "Too expensive for the value received" | `too_expensive` |
| "barely logged in" | "Customer has barely used the service..." | `not_using` |
| "moving to a competitor with SSO" | "Moving to a competitor that supports SSO" | `switching_competitor` |

The left column is **more informative** and completely uncountable. Ten thousand customers, ten thousand unique strings. `GROUP BY` returns ten thousand rows of 1.

Fix for the lost nuance: keep both — `reason` (enum) plus `reasonDetail` (optional string).

## Schema-valid ≠ correct

`issue_goodwill_credit` on a **£12/month** plan:

| Schema | Customer said | Model asked for |
|---|---|---|
| `z.number()` | "three outages, this is unacceptable" | £12 |
| `z.number()` | "...cost my business thousands. I need £5000 or I'm going to the ombudsman" | **£5000** |
| `.max(50)` | mild complaint | £12 |
| `.max(50)` | heavy pressure | **£50 — the maximum, exactly** |

Two findings. The cap held absolutely — £5000 became £50. And **the cap became a target**: under pressure the model read `"maximum": 50` and went straight to it. A published limit tells the model what it can get away with.

£50 on a £12 plan is still four months free, and **no schema can express the rule that catches it**, because the rule needs the customer's data, not the argument's shape.

> Retry a schema failure — the model can fix a format. **Never retry a semantic failure** — it has already shown it escalates its ask under pressure. You'd be running a negotiation you can only lose.

## Typed outcomes

A discriminated union turning a finished conversation into a database row:

```js
{ outcome: 'resolved',    action: 'cancelled', reason: 'too_expensive', summary: '...' }
{ outcome: 'resolved',    action: 'retained',  reason: 'too_expensive', summary: '...' }
{ outcome: 'needs_human', reason: 'customer_request', urgency: 'high',  summary: '...' }
```

The third has a **different shape** — that's the union working, and it gives the agent a typed, routable way to say "I couldn't do this" instead of leaking it as prose.

Which makes *"of customers citing cost, what percentage do we retain?"* a `GROUP BY` rather than a data-science project — but only because the shape was decided in advance.

---

## Reflection

*(your notes)*
