# Day 16 — Multi-Step Planning

> Week 3 · Agent platform · Project: [04-agent-factory](../../projects/04-agent-factory/)

## Objective

You can build an agent that handles tasks requiring a variable number of dependent steps, keeps its plan visible and revisable, and fails safely partway through.

---

## Concepts

### When planning earns its keep

Reactive tool-use (day 3) decides one step at a time. That works until:

- The number of steps varies with the request
- Steps have **dependencies** — step 4 needs step 2's output
- The task spans time — hours or days, not one conversation
- A human needs to see and approve the approach **before** anything executes
- Partial completion is possible and must be recoverable

Example: *"Organise the club championship weekend."* Block the tee sheet, notify affected members, open entries, set the handicap cut-off, arrange catering, book the prize-giving, publish the draw. Seven steps, several dependencies, days of elapsed time, and a partial completion is a real operational mess.

A reactive loop cannot show you what it intends to do. That is often the point of planning: **the plan is an artefact you can inspect, approve, and audit before anything happens.**

### Plan as data

```ts
const Plan = z.object({
  goal: z.string(),
  steps: z.array(z.object({
    id: z.string(),
    description: z.string(),
    tool: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    dependsOn: z.array(z.string()),
    reversible: z.boolean(),
    requiresApproval: z.boolean(),
    status: z.enum(["pending","ready","running","done","failed","skipped"]),
    result: z.unknown().optional(),
    attempts: z.number().default(0),
  })),
  status: z.enum(["draft","approved","executing","paused","complete","failed"]),
});
```

Because it is data, it can be persisted, shown to a human, diffed after replanning, resumed after a crash, and asserted on in evaluation. A plan that only exists inside the model's reasoning gives you none of that.

### Plan validation before execution

**Never execute a model-generated plan without validating it.** Check, in code:

- Every named tool exists
- Arguments type-check against the tool schema
- The dependency graph is acyclic
- No step violates policy (day 6 — run the policy engine over the *plan*)
- The step count and estimated cost are within bounds
- Irreversible steps are ordered last within their dependency group

This is a validation funnel over a plan instead of over a single output — same discipline as day 4.

### Execution

Execute the dependency graph, not the list order. A step becomes `ready` when all its dependencies are `done`. Independent steps can run in parallel — but be careful: parallel writes to the same resource reintroduce day 10's race conditions.

On step failure, you need a per-step policy: retry, skip and continue, replan from here, or abort and compensate. **Decide this per step at plan time**, not at failure time in an exception handler.

### Replanning, and the trap

The world changes mid-plan. A slot gets taken; a member cancels. So you replan.

**The trap: an unbounded replan loop.** Fail → replan → fail → replan. This is the single most expensive agent failure mode there is — it burns money in a tight loop, and it looks like progress.

Bound it: maximum 3 replans per plan, maximum total cost, and escalate on exhaustion. Also require that a replan **preserves completed steps** — replanning must not re-execute what already succeeded, which means your steps need to be idempotent (day 10 again).

### Human approval of plans

The highest-value pattern in this whole area:

```
Here's my plan for the championship weekend:

  1. Block tee sheet, Sat 08:00–14:00                    [reversible]
  2. Email 240 members about restricted play             [IRREVERSIBLE]
  3. Open competition entries, close Thu 18:00           [reversible]
  4. Set handicap cut-off at 24                          [reversible]
  5. Order catering for 80                               [cost: ~£640]
  6. Book prize-giving room, Sat 17:00                   [reversible]
  7. Publish draw Fri 09:00                              [reversible]

Steps 2 and 5 need your approval. Proceed?
```

The human reviews **intent** once, rather than approving seven actions individually. Far better ergonomics, and a genuine safety control — it is day 12's assisted mode applied at the plan level.

Note the annotations. Reversibility and cost are what the human is actually deciding on.

### Long-running plans

If a plan spans days, the process will restart. That means:

- Plan state persists in a database, not in memory
- Every step is resumable and idempotent
- Steps can be scheduled and time-triggered
- Timeouts on individual steps, with a defined action
- Notification when a plan needs attention

This is durable workflow execution. It is also the strongest justification for adopting something like LangGraph's checkpointing — and now you know exactly what you'd be buying.

---

## Architecture

```
    goal
     │
     ▼
 ┌─────────┐
 │ PLANNER │  LLM → structured Plan
 └────┬────┘
      ▼
 ┌──────────────────┐  invalid  ┌──────────┐
 │ PLAN VALIDATOR   ├──────────▶│ Replan   │──▶ (max 3)
 │ tools · types ·  │           │ or fail  │
 │ DAG · policy ·   │           └──────────┘
 │ cost · ordering  │
 └────┬─────────────┘
      ▼
 ┌──────────────────┐
 │ APPROVAL GATE    │  if any step irreversible / costly
 └────┬─────────────┘
      ▼
 ┌──────────────────┐
 │    EXECUTOR      │  DAG order · per-step retry policy ·
 │  (persisted)     │  compensation · idempotent · resumable
 └────┬─────────────┘
      │ world changed?
      ▼
 ┌──────────────────┐
 │    REPLANNER     │  preserves completed steps · bounded
 └──────────────────┘
```

---

## Exercise

Work in `projects/03-golf-club-agent/` — the championship weekend scenario.

**1. Define the `Plan` schema** and persist plans in SQLite.

**2. Build the planner.** Structured output. It must annotate each step with dependencies, reversibility, and approval requirement.

**3. Build the plan validator** with all six checks. Test it against deliberately bad plans: a nonexistent tool, a cyclic dependency, a policy-violating step, an irreversible step ordered before a reversible one, and a 40-step plan.

**4. Build the executor.** DAG-ordered, persisted after every step, resumable. **Kill the process mid-plan and resume it** — this is the test that matters.

**5. Implement per-step failure policies** and compensation for the steps that need it.

**6. Implement bounded replanning.** Prove it preserves completed steps and prove it terminates. Write a test where the world changes on every attempt and assert that it escalates rather than looping.

**7. Build plan approval.** Render the plan for a human as in the example above — annotated with reversibility and cost. Approve, reject, or **edit** a step. Edited plans must be re-validated.

**8. Add a scheduled step** — "publish the draw at 09:00 Friday". Now the plan spans real time.

**9. Compare against reactive.** Run the same championship task with a plain tool-use loop. Compare: did it complete, how many steps, what did it cost, and could you have seen what it was about to do?

**10. Evaluate plans.** Add plan-quality cases to the golden set: assert the plan contains the required steps, in a valid order, with correct reversibility annotations. **Evaluate the plan, not just the outcome** — a good outcome from a reckless plan is luck.

---

## Deliverable

- [ ] `Plan` schema, persisted
- [ ] Planner producing annotated plans
- [ ] Validator with six checks + bad-plan tests
- [ ] DAG executor, resumable — **proven by killing the process**
- [ ] Per-step failure policies and compensation
- [ ] Bounded replanning, proven to terminate and to preserve completed work
- [ ] Human approval with reversibility and cost annotations, plus editing
- [ ] One scheduled step
- [ ] Reactive vs. planned comparison
- [ ] Plan-quality eval cases
- [ ] `journal/day-16.md`

---

## Reflection

1. Where did planning genuinely beat the reactive loop? Where was it just more machinery?
2. Your replan loop is bounded at 3. What does the member experience on the third failure? Is that acceptable?
3. Which step in the championship plan is truly irreversible? What would you require before executing it?
4. How does plan approval change the product? Who is accountable for a plan a human approved?
5. What did resuming after a crash reveal that you hadn't handled?

---

## Interview Question

> "Design an agent that handles a multi-day business process with human checkpoints."

Strong answers make the plan an explicit, persisted, inspectable artefact rather than something living in the model's context; validate the plan in code before executing any of it; separate reversible from irreversible steps and gate the latter; persist after every step so the process can crash and resume; make steps idempotent so resumption is safe; bound replanning and escalate on exhaustion; and design the human checkpoint as approval of *intent* — the whole plan — rather than approval of each action. Look for someone who mentions that the plan itself should be evaluated, not just the final outcome. Weak answers describe an agent that "keeps working until it's done" with no persistence story.

---

**Next:** [Day 17 — Agent generation](day-17.md)
