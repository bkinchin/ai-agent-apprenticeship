# Day 3 — Tool Calling

> Week 1 · Foundation · Project: [01-hello-agent](../../projects/01-hello-agent/) → [02-subscription-cancellation-agent](../../projects/02-subscription-cancellation-agent/)

## Objective

You can design a tool interface that an LLM uses correctly, implement the execution loop yourself, and enumerate the failure modes of every tool you expose.

Today is the rung-3 day. After this, your system can act.

---

## Concepts

### What a tool call actually is

There is no magic. A tool call is:

1. You describe available functions to the model, as JSON Schema, in the request.
2. The model returns — instead of prose — a structured request: *"call `get_subscription` with `{customerId: "CUST-1029"}`"*.
3. **Your code executes it.** The model cannot call anything. It emits an intention.
4. You append the result to the message array and call the model again.
5. Repeat until the model returns prose instead of a call.

Step 3 is the whole security and reliability story. The model **proposes**; your code **disposes**. Every guardrail you will ever build lives in that gap.

### The tool-use loop

```ts
while (steps < MAX_STEPS) {
  const response = await llm(messages, tools);
  messages.push(response.message);

  if (!response.toolCalls?.length) return response.message;   // done

  for (const call of response.toolCalls) {
    const result = await executeTool(call);                    // your code, your rules
    messages.push({ role: "tool", tool_call_id: call.id, content: result });
  }
  steps++;
}
throw new MaxStepsExceeded();
```

Twelve lines. That is an agent. Everything else in this apprenticeship is making those twelve lines safe, observable, evaluable, and correct.

Note `MAX_STEPS`. Without it you have an unbounded loop calling a paid API. Set it to 8 and alert when you hit it — hitting the cap is a signal, not just a stop.

### Tool design is the actual skill

Model quality is largely out of your control. **Tool design is entirely in your control, and it dominates agent reliability.**

Principles, in priority order:

**1. Name and describe for a competent new starter, not a machine.** The description is a prompt. It is the highest-leverage text in your system.

```
✗ get_sub(id)          "gets sub"
✓ get_subscription     "Retrieve a customer's current subscription: plan,
                        price, billing cycle, renewal date, and status.
                        Use before discussing any change to their plan.
                        Requires a verified customer ID."
```

Say *when to use it*, not just what it does.

**2. Make the right thing easy and the wrong thing impossible.** Don't expose `updateSubscription(fields)` and hope the model only changes the right field. Expose `cancelSubscription(customerId, reasonCode)`. Narrow tools are safer than flexible ones. Enums beat free text everywhere.

**3. Fewer tools, better named.** Beyond roughly 15–20 tools, selection accuracy falls off. If you need more, group them behind a router or split the agent.

**4. Return what the model needs to decide, not your database schema.** Strip nulls, IDs it can't use, and internal fields. Every unnecessary token is both cost and distraction.

**5. Errors are prompts.** A tool error goes straight back into the model's context. Write it for the model:

```
✗ "ERR_5521"
✗ "TypeError: cannot read property 'plan' of undefined"
✓ "No subscription found for CUST-9999. The customer ID may be wrong,
   or this customer has never subscribed. Ask the customer to confirm
   their email address and look them up again."
```

Good error text turns a dead end into a recovery. This is one of the highest-value things you will do all week.

**6. Validate arguments. Always.** The model will eventually send `{"customerId": "the customer's ID"}`. Zod at the boundary, and a validation failure returns a helpful error message rather than throwing.

### Read tools vs. write tools

The most important classification in your tool inventory:

| | Read | Write |
|---|---|---|
| Effect | None | Changes the world |
| Retry safe? | Yes | Only if idempotent |
| Needs confirmation? | No | Usually |
| Needs audit? | Sometimes | Always |
| Bad call costs | Tokens | Money, trust, a customer |

Tag every tool. Treat write tools as a different category of object with different rules — confirmation, idempotency key, audit record, policy check. You will formalise this on day 6.

---

## Architecture

```
   Model proposes  ──▶  ┌──────────────────────────┐
    tool call            │      Tool Executor       │
                         │                          │
                         │  1. tool exists?         │
                         │  2. schema valid? (Zod)  │
                         │  3. policy allows? (d6)  │
                         │  4. confirmation needed? │
                         │  5. execute w/ timeout   │
                         │  6. map errors for model │
                         │  7. trace everything     │
                         └────────────┬─────────────┘
                                      ▼
                              Systems of record
```

Steps 1–4 and 6–7 are yours and are where reliability comes from. Step 5 is the easy part.

**Timeouts:** every tool gets one. A hanging tool call hangs the conversation, and the user is *waiting*. 5 seconds is a reasonable default for an interactive agent; anything slower needs an async pattern.

**Idempotency:** if `cancelSubscription` is called twice due to a retry, the second call must be a no-op that reports success, not a second cancellation. Pass an idempotency key derived from the session and step.

---

## Exercise

Start `projects/02-subscription-cancellation-agent/`. This is the agent you will develop for the rest of week 1.

**1. Build the fake backend first.** `src/data/` — a seeded SQLite DB with customers and subscriptions. Include awkward cases deliberately: a customer with two subscriptions, one already cancelled, one in a trial, one past due. Real data is not tidy and your agent must survive that.

**2. Define a `Tool` type.**

```ts
interface Tool<A> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  kind: "read" | "write";
  execute: (args: A, ctx: ToolContext) => Promise<ToolResult>;
}
```

**3. Implement four tools:**

| Tool | Kind | Notes |
|---|---|---|
| `find_customer` | read | By email. Handle not-found and multiple-match. |
| `get_subscription` | read | Full state. Handle no-subscription. |
| `get_retention_offers` | read | Eligible offers for this plan. |
| `cancel_subscription` | write | Requires reason code (enum). Idempotent. |

**4. Convert Zod schemas to JSON Schema** for the API. Use `zod-to-json-schema`, or write the conversion by hand for the four shapes you need — doing it by hand once is genuinely instructive.

**5. Write the executor.** Validation, timeout, error mapping, and a trace log of every call: name, args, duration, result or error.

**6. Write the agent loop** with `MAX_STEPS = 8`.

**7. Break it deliberately.** Try each and record what happens in your journal:
- Ask about a customer that doesn't exist
- Ask to cancel without giving an email
- Make a tool throw an exception
- Make a tool take 30 seconds
- Ask something no tool can answer
- Ask it to cancel someone else's subscription

**8. Rewrite your worst error message** based on what you learned in step 7, and re-run.

---

## Deliverable

- [ ] Seeded SQLite backend with awkward cases
- [ ] Four tools with Zod schemas and read/write tags
- [ ] Executor: validation, timeout, error mapping, tracing
- [ ] Agent loop with step limit
- [ ] `projects/02-subscription-cancellation-agent/README.md`
- [ ] `docs/architecture/tool-design.md` — your principles, with a before/after example from step 8
- [ ] `journal/day-03.md` — the failure table from step 7

---

## Reflection

1. Which of your six deliberate failures was handled worst? Was the fix in the prompt, the tool description, the error message, or the code? (Note which — the answer is usually *not* the prompt.)
2. Give a concrete scenario where `cancel_subscription` gets called twice for one user intent. What does your idempotency key have to be derived from?
3. Your tool returns 40 fields. What are the costs of that, beyond tokens?
4. When should a tool refuse to execute rather than returning data? What does it return instead?
5. You now have four tools. Sketch the inventory for a real subscription business — how many tools, and where does the 15–20 limit bite?

---

## Interview Question

> "Design the tool interface for an agent that handles billing disputes. Walk me through your tools, and tell me which one you're most worried about."

Strong answers: separate read from write early; scope write tools narrowly (`issue_goodwill_credit` with a capped amount, not `adjustBalance`); build in limits the model cannot exceed rather than instructing it not to; require confirmation and audit on anything irreversible; and name the risky tool honestly — usually the one that moves money — with the specific control that contains it. The best answers mention that the *amount* should be a validated enum or bounded number, not a free integer the model chooses.

---

**Next:** [Day 4 — Structured outputs](day-04.md)
