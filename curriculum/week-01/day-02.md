# Day 2 — Conversation State

> Week 1 · Foundation · Project: [01-hello-agent](../../projects/01-hello-agent/)

## Objective

You can explain why state is an architectural concern rather than a storage detail, and you have a session store that survives process restart.

---

## Concepts

### State is a construction, not a given

Yesterday: the model is stateless. Continuity is something **you** assemble and pass in on every call.

That means "conversation state" is a design decision with real consequences:

- **What** you keep (all turns? summaries? extracted facts?)
- **Where** it lives (memory? SQLite? Redis? the client?)
- **How long** it lives (turn? session? forever?)
- **Who** can read it (the model? the user? support staff? auditors?)

Get these wrong and you have either an amnesiac product or a GDPR incident.

### The four kinds of state in an agent

People say "state" and mean four different things. Separate them now — most agent bugs live at these boundaries.

| Kind | Example | Lifetime | Owner |
|---|---|---|---|
| **Conversation state** | The message array | Session | Agent runtime |
| **Task state** | "verification passed, retention offered" | Session / workflow | Your code |
| **Business state** | Subscription status in the billing DB | Permanent | System of record |
| **Memory** | "This customer prefers email" | Cross-session | Memory store (day 11) |

**The critical rule: the model must never be the source of truth for business state.** If the model "believes" the subscription is cancelled, that belief is worthless. The billing system is the truth. The model's job is to read truth and propose changes to it — never to hold it.

Violating this rule is the number-one cause of agents that appear to work in demo and corrupt data in production.

### The context window is a budget

Context is finite, costs money on every turn, and — crucially — **model attention degrades before the window fills**. Information in the middle of a long context is measurably less influential than information at the start or end.

So you need a **context assembly strategy**, not just a growing array. The options:

| Strategy | Cost | Fidelity | When |
|---|---|---|---|
| Full history | Grows O(n²) over a session | Perfect | Short sessions (< 20 turns) |
| Sliding window (last N) | Constant | Loses early context | Chat where recency dominates |
| Summarise + recent | Constant-ish | Lossy, compounding | Long sessions |
| Structured extraction | Small | Loses nuance, keeps facts | Task-driven agents ← *usually right* |

Note the O(n²): turn 50 resends turns 1–49. Total tokens across a session grows quadratically. This is the single largest cost driver in conversational AI products and almost nobody models it before launch.

The fourth strategy is the enterprise answer. Instead of hoping the model remembers the customer ID from turn 3, you **extract it into task state** and inject it deterministically:

```
system: You are helping a verified customer.
        Customer: CUST-1029 (verified at 14:02)
        Subscription: PRO, £49/mo, renews 2026-08-14
        Stage: retention_offered
[... last 6 turns of conversation ...]
```

Now turn 40 is as reliable as turn 4, and it costs the same.

### Sessions and identity

A session needs an ID before the first message, not after. You need it for: resuming, tracing, evaluation replay, audit, and support ("what did the bot tell me?"). Generate it at the channel boundary and carry it everywhere.

---

## Architecture

```
   ┌──────────────────────────────────────────────┐
   │              Context Assembler               │
   │                                              │
   │   system prompt   (static, versioned)        │
   │   + task state    (structured, deterministic)│
   │   + memory        (retrieved, day 11)        │
   │   + knowledge     (retrieved, day 9)         │
   │   + recent turns  (windowed)                 │
   │   + current input                            │
   └───────────────────┬──────────────────────────┘
                       ▼
                   [ messages ] ──▶ LLM
```

Everything from day 9 onwards plugs into this diagram. Build the seam today and the rest of the programme slots in.

**Persistence:** SQLite. Two tables is enough:

```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  task_state   TEXT NOT NULL DEFAULT '{}'   -- JSON
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  role        TEXT NOT NULL,               -- system|user|assistant|tool
  content     TEXT,
  tool_calls  TEXT,                        -- JSON, day 3
  created_at  TEXT NOT NULL,
  tokens      INTEGER
);
```

Why SQLite and not Redis or Postgres? Because it is a file, it has zero operational cost, and it is more than fast enough to teach you the shape of the problem. When you outgrow it you will know exactly why — and *that* is the lesson.

---

## Exercise

Continue in `projects/01-hello-agent/`.

> **Order matters here.** Feel the problem, try the naive fix, watch it break, then build the real one. Storage comes last — it is plumbing, and plumbing built before you know the shape of the problem is plumbing you rip out.

**1. Measure the problem.** Run `src/cost-curve.ts`. Record the 30-turn numbers and the ratio in your journal. Note where cumulative cost stops being linear.

**2. Add a sliding window** to `src/index.ts` — `history.slice(-WINDOW)`, N configurable. Confirm the per-turn `in` count goes flat.

**3. Break it deliberately.** State a fact on turn 1, fill the window with chatter, then ask about the fact. Watch it fail. **This failure is the point of the day** — you traded cost for correctness.

**4. Add task state.** Extract one fact (the user's name will do) into a small object, and inject it into the `system` string. Now run with `WINDOW=2` and confirm it still knows the name from turn 1. Same cost, correct answer.

**5. Build a `ContextAssembler`** — a function `assemble(state, history, input) -> { system, messages }`. Move steps 2 and 4 inside it. It becomes the single place the request is constructed, and everything from day 9 onwards plugs into it.

**6. Define the session interface**, now that you know what it has to hold.

```ts
interface SessionStore {
  create(): Promise<Session>;
  load(id: string): Promise<Session | null>;
  append(id: string, message: Message): Promise<void>;
  setTaskState(id: string, patch: Record<string, unknown>): Promise<void>;
}
```

Interface first is deliberate — but only *now*, once steps 1–5 have shown you what it must hold. You will swap the implementation twice in this programme.

**7. Implement it twice.** `InMemorySessionStore` and `SqliteSessionStore` (use `node:sqlite`, built into Node 22+). Same interface. Prove your agent code doesn't change when you swap them.

**8. Add `--session <id>` to the REPL.** Restart the process, resume the conversation, confirm it remembers. This is the moment state becomes real.

---

## Deliverable

- [ ] `SessionStore` interface with two implementations
- [ ] SQLite persistence; conversations survive restart
- [ ] `ContextAssembler` as the single place messages are built
- [ ] Sliding window + task-state injection, both working
- [ ] Token measurements comparing strategies
- [ ] `journal/day-02.md`

---

## Reflection

1. You resend the full history each turn. Why does total session cost grow quadratically, and at what turn count does that become the dominant cost of your product?
2. A user says "cancel it" on turn 12, referring to something mentioned on turn 3. Under a 6-turn window, what happens? How do you fix it *without* enlarging the window?
3. Where should conversation state live for: a web chat, a phone call, an email thread, a Slack bot? Justify each — they are not the same answer.
4. A customer invokes their right to erasure. What exactly do you delete, and what breaks when you do?
5. Why must business state never live in the model's context as the source of truth? Describe the specific incident that results.

---

## Interview Question

> "Your agent handles conversations averaging 40 turns. Costs are three times what you forecast and quality drops off after turn 20. Diagnose it and give me your remediation plan."

A strong answer separates the two symptoms — cost is the O(n²) resend, quality is attention degradation over long context, and they have different fixes. Then: measure first (tokens per turn, quality by turn index), move from history-replay to structured task state, keep a short recency window, summarise or drop the middle, and validate with an eval set stratified by turn depth. A weak answer jumps straight to "use a bigger context window", which makes both problems worse.

---

**Next:** [Day 3 — Tool calling](day-03.md)
