# src/

Three folders, three purposes.

```
run/     things you run          ← start here
core/    the actual system
learn/   day-by-day demos        ← teaching devices, not product
```

## `run/` — entry points

| File | Command | What it does |
|---|---|---|
| `chat.ts` | `npm run chat` | Talk to the agent yourself. Slash commands expose the internals. |
| `scenarios.ts` | `npm run scenarios` | Three scripted conversations, including the day-3 attack. |

Neither calls the other. They are **two front doors onto the same core.**

## `core/` — the system

```
                 run/chat.ts        run/scenarios.ts
                       │                   │
                       └─────────┬─────────┘
                                 ▼
                         conversation.ts        the loop, stages, escape hatches
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
         executor.ts        workflow.ts         policy.ts
     the only way to      stages, TaskState,   rules loaded from
      run a tool          canTransition()      shared/policies/*.yaml
```

| File | Responsibility |
|---|---|
| `conversation.ts` | One conversation: the loop, stage transitions, escape hatches |
| `executor.ts` | **The only way to run a tool.** schema → policy → execute → audit |
| `workflow.ts` | Stages, `TaskState`, `canTransition()`. Pure functions |
| `policy.ts` | Loads and validates the YAML; `evaluate()` |
| `context.ts` | `assemble()` — builds `{ system, messages }` |
| `session.ts` | `SessionStore` interface + in-memory implementation |
| `sqlite-store.ts` | Same interface, on disk |

Tests sit alongside the code they test. **51 assertions, no API key, under a second:**

```bash
npm test
```

## `learn/` — demos

One or more per day. Each is standalone and disposable; none is imported by `core/` or `run/`.

| Day | Files |
|---|---|
| 1–2 | `index.ts` (the original REPL), `cost-curve.ts`, `try-session.ts`, `try-sqlite.ts` |
| 3 | `tool-demo.ts`, `loop-demo.ts`, `write-demo.ts` |
| 4 | `validation-demo.ts`, `what-is-a-schema.ts`, `enum-demo.ts`, `semantic-demo.ts`, `outcome-demo.ts` |
| 5 | `scoped-tools-demo.ts` |

Run any of them directly:

```bash
npx tsx --env-file=../../.env.local src/learn/loop-demo.ts
```

Some need no API key at all — `validation-demo.ts`, `what-is-a-schema.ts`.

## The rules that keep this honest

- **`core/` imports nothing from `run/` or `learn/`.**
- **`learn/` is never imported by anything.** Delete any of it and the system still works.
- **Tool implementations live only in `executor.ts`**, unexported. There is no second path to a tool.
