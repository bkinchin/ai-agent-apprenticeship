# Day 2 — Conversation State

**Project:** 01-hello-agent · **Commits:** `b861165`, `60a6fae`

---

## What I built

| File | |
|---|---|
| [`core/context.ts`](../projects/01-hello-agent/src/core/context.ts) | `assemble()` — the single place `{ system, messages }` is built |
| [`core/session.ts`](../projects/01-hello-agent/src/core/session.ts) | `SessionStore` interface + in-memory implementation |
| [`core/sqlite-store.ts`](../projects/01-hello-agent/src/core/sqlite-store.ts) | Same interface, on disk |
| [`learn/cost-curve.ts`](../projects/01-hello-agent/src/learn/cost-curve.ts) | Measures token growth using the API's own counter |

## The numbers

Measured over 30 turns, not estimated:

| Turns | Cumulative input tokens |
|---|---|
| 10 | 4,025 |
| 20 | 15,950 |
| 30 | 35,775 |

Double the turns, **four times** the cost. That's n² — you resend everything, every turn.

| | 30 turns | at 100k conversations/day |
|---|---|---|
| Full history | 35,775 tokens | **$17,888/day** |
| Sliding window (6) | 8,073 tokens | **$4,037/day** |

**$6.5M vs $1.5M a year.** Nobody models this before launch.

## The trade, and the way out

A sliding window fixes the cost and breaks correctness — say your name on turn 1, fill the window with chatter, ask on turn 6, and it's gone.

The fix isn't a bigger window. It's **structured task state**: extract the facts that matter into a small object and inject them into `system`, which is a separate parameter from `messages`.

Proved it with `WINDOW = 2` — four turns discarded, and it still answered "Billy" correctly. Same cost, right answer.

> **Don't make the model remember. Make your code remember, and tell the model.**

Cost of that: you lose everything you didn't think to extract. Predictable loss instead of unpredictable loss — an improvement, not a free one.

## The bug the tests found

Nine assertions on `assemble()`, **51ms, no API key.** One failed:

```js
[1, 2, 3].slice(-1)   // [3]         ✓
[1, 2, 3].slice(-0)   // [1, 2, 3]   ← everything
```

`-0 === 0` in JavaScript, and `slice(0)` returns the whole array. So `window: 0` — the setting that should send the *least* — sent the **most**. Silently, with no error, at 1000× the token cost.

Written 20 minutes earlier. Typechecked. Worked in the REPL. Would have shipped.

Found by asserting on a pure function in half a second. That's what pulling assembly out of the loop bought — not tidiness, the ability to ask precise questions and get answers instantly.

## Persistence

`SessionStore` defined first, implemented twice. Conversation resumed across **two separate processes**:

```
$ npm start
new session ea431b57-...
you › My name is Billy
                                    ← process exits

$ npm start -- --session ea431b57-...
resumed session — 2 messages already
you › What is my name?
claude › Your name is Billy.
```

Swapping in-memory for SQLite is one word. That's what defining the interface first bought.

---

## Reflection

*(your notes)*
