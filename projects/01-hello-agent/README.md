# Project 1 — Hello Agent

> **Status:** not started · **Days:** 1–2 · **Prerequisites:** none

## Purpose

Understand the basic LLM interaction model, from first principles, with nothing hiding it.

By the end you should be able to state exactly what the model receives on any given turn, and why it produces what it does. Every later project rests on this.

## What you will learn

- Messages, roles, and the request/response shape
- That the model is **stateless** — and what that implies
- How conversation history is constructed and what it costs
- Where session state lives and how it survives a restart
- Context assembly as an explicit, single-responsibility component

## What you will build

| Day | Build |
|---|---|
| [1](../../curriculum/week-01/day-01.md) | Multi-turn REPL with `--forget` and `--verbose` flags |
| [2](../../curriculum/week-01/day-02.md) | `SessionStore` (in-memory + SQLite), `ContextAssembler`, sliding window, task-state injection |

## Architecture

```
   stdin
     │
     ▼
  ┌────────────────────┐      ┌──────────────────┐
  │ ContextAssembler   │◀─────│  SessionStore    │
  │  system + task     │      │  (SQLite)        │
  │  state + window    │─────▶│                  │
  └─────────┬──────────┘      └──────────────────┘
            ▼
      [ messages ] ──▶ OpenAI API ──▶ response
```

The `ContextAssembler` is the only place the messages array is built. That constraint is deliberate — it is the seam that everything from day 9 onwards plugs into.

## Structure

```
01-hello-agent/
├── src/
│   ├── index.ts              # REPL entry point
│   ├── context.ts            # ContextAssembler
│   ├── session/
│   │   ├── types.ts          # SessionStore interface
│   │   ├── memory.ts
│   │   └── sqlite.ts
│   └── llm.ts                # thin API wrapper — one place model calls happen
├── data/                     # SQLite file (gitignored)
└── README.md
```

## Setup

```bash
npm init -y && npm i openai zod dotenv && npm i -D typescript tsx @types/node
```

`OPENAI_API_KEY` goes in the repo-root `.env`.

## Usage

```bash
npx tsx src/index.ts                       # new session
npx tsx src/index.ts --session s_8f2a      # resume
npx tsx src/index.ts --verbose             # print the full messages array each turn
npx tsx src/index.ts --forget              # send only the latest message
npx tsx src/index.ts --window 6            # sliding window of 6 turns
```

## Deliberately not here

No tools, no policies, no evaluation, no framework. Those arrive when you have felt their absence.

## Done when

- [ ] Multi-turn conversation works and persists across restart
- [ ] `--forget` visibly breaks continuity — and you can explain precisely why
- [ ] A 30-turn conversation with a 2-turn window still knows a fact from turn 1, via task state
- [ ] You have token and cost numbers comparing full history vs. windowed
- [ ] `docs/architecture/what-is-an-agent.md` written in your own words
