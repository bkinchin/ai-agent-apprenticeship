# shared/memory

Cross-session memory. Subject-scoped, provenanced, expiring, deletable.

## The governing rule

**If a system of record knows it, don't remember it — look it up.**

Memory is for what no system records: preferences expressed in conversation, context about a person's situation, the history of your relationship with them. Caching a handicap or a membership category in "memory" is a stale-data bug waiting to happen.

## The shape

```ts
interface Memory {
  id: string;
  subjectId: string;              // scoped — leakage is the catastrophic failure
  type: "factual" | "preference" | "episodic";
  key: string;
  value: unknown;
  confidence: number;
  source: { sessionId: string; turnIndex: number; quote: string };
  createdAt: string;
  lastConfirmedAt: string;
  expiresAt?: string;
}
```

`source.quote` is non-negotiable. When a memory turns out to be wrong you must be able to see what was actually said.

## Write policy

Extract at **session end**, not per turn. Start with explicit-only ("remember that I…") and add extraction once you have felt the noise problem.

## Retrieval

Budgeted — 5 to 10 memories, a few hundred tokens. Injected with **fallible framing**:

> *What you know about this member (from previous conversations — may be out of date; verify anything important before acting on it)…*

Presenting memory as fact makes the model act on stale beliefs.

## Required operations

Not optional, and not merely GDPR compliance — they are product features:

- **Show** — "what do you remember about me?"
- **Correct** — "that's wrong, it's X"
- **Delete** — and it must actually be gone, including from traces and eval sets

## Required test

An automated cross-subject leakage test that lives in the suite permanently.

> **Populated from:** day 11
