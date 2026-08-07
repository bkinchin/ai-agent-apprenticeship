# Day 1 — What is an AI Agent?

**Project:** 01-hello-agent · **Commits:** `cc0d4a0`, `9848bb6`

> Written as a factual record of what happened. The Reflection section is
> for your own notes — delete it or fill it in.

---

## What I built

A multi-turn chat loop, one file, ~55 lines: [`src/learn/index.ts`](../projects/01-hello-agent/src/learn/index.ts).

- A `history` array holding both sides of the conversation
- `--forget` — sends only the latest message
- `--verbose` — prints the full `system` and `messages` before each call
- Token and cost accounting per turn

## Decision: Claude API rather than OpenAI

Changed from the spec's stack. Three consequences that mattered later:

| | |
|---|---|
| `system` is a **top-level parameter**, not a message | Instructions and conversation are structurally separate — day 2 is built on this |
| `response.content` is a **typed block array**, not a string | Meant day 3's tool calls were a small change rather than a rewrite |
| **No `temperature`** — rejected with a 400 | Removed the "temperature 0 for reproducibility" advice from days 7 and 18 |

That third one is worth sitting with. The industry's habitual determinism dial doesn't exist here, and it never guaranteed identical outputs anyway. You don't get reproducibility; you get measurement.

## The experiment that matters

Same model, same question, twice:

```
normal:      "Your name is Billy — you just told me."        in 63 tokens
--forget:    "I don't have access to your name..."           in 34 tokens
```

**The only difference was the contents of the `messages` array.** The model has no memory; `history` is the memory, and it's an ordinary array you maintain and resend every turn.

## The comprehension question

*What breaks if you delete the line that appends the assistant's reply?*

My answer: it would forget my name and the conversation would go nowhere.

**Wrong, and the way it's wrong is more interesting.** Tested it:

```
history without assistant turns:
  user: "My name is Billy"
  user: "What is my name?"
→ "Your name is Billy. Nice to meet you!"          ← still knows
```

The user messages are pushed by a *different line*, which still runs. What actually breaks is the model seeing **its own words**:

```
  user: "I want to cancel my subscription"
  user: "yes"
→ "Could you tell me which subscription you're referring to?"   ← flounders
```

vs. with the assistant turn intact:

```
→ "'yes' could mean either option. Should I cancel now, or at the end of the period?"
```

**It doesn't crash.** No error, no warning. It produces a fluent, polite, wrong conversation. First encounter with the failure mode that recurred every single day this week.

## Numbers

| | |
|---|---|
| Model | `claude-opus-5` |
| Turn 1 input | 35 tokens |
| Turn 2 input | 63 tokens |
| Cost per exchange | ~$0.0017 |

---

## Reflection

*(your notes)*
