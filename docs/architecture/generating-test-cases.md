# Generating Test Cases

**Status:** proposal, not built · **Written:** day 11 · **Decided:** day 18

An agent that reads a business specification and emits a conversational golden set — clean paths, edge cases, and things that should break — then asks the person who wrote the spec whether the cases make sense.

Written on day 11 so that day 18 tests a **prediction** rather than an intuition. If this turns out to be wrong, that is the useful outcome.

---

## Why it looks obviously right

Day 18 already schedules it, and the mechanics are sound. Every element of a spec implies cases:

| Spec element | Cases |
|---|---|
| Each job | happy path ×3 phrasings, missing information, mid-flow change of mind |
| Each policy rule | compliant, violating, **violating under user pressure** |
| Each escalation trigger | fires, and a near-miss that does not |
| Each tool | success, error, timeout, empty result |
| Knowledge sources | answerable, and **unanswerable** |
| Anti-requirements | an attempt at each, asserted to fail |

Sixty to a hundred cases from a spec, mechanically. Against the usual alternative — nothing on day one — that is a real baseline.

---

## The objection, with evidence

**Every defect found in project 03 was found by a person typing at the agent.** Here is what those inputs actually looked like:

```
"can I bring my dogg??"                                 a typo
"the 9:20, just me. I usually play early with the       an aside inside a request
 same three lads"
"no thanks"                                             answering the wrong question
"book me saturday the 29th"                             no year given
"remember I'll always need a buggy" (after mentioning   a sensitive clause the model
 a knee replacement)                                     would trim away
```

Now consider what a model produces when asked for edge cases: empty input, very long input, contradictory instructions, prompt injection, abuse. **Neat adversarial inputs.**

None of the five above is on that list. They are ordinary human sloppiness — a different distribution, and the one that produced every real defect.

> **A generator asked for edge cases produces the edge cases it can imagine, and it shares a distribution with the agent it is testing.** Same model family, same blind spots. Asking it to find what it does not know is asking the wrong question of the wrong thing.

### The second objection is about the human step

The proposal includes a human check, which is the right instinct and is weaker than it looks.

> **Approval at volume is a rubber stamp.** Handed eighty generated cases, you cannot tell a good one from a plausible one — and plausible is precisely what a model is best at producing. The review is weakest exactly where the volume is highest, which is the situation generation creates.

### Which direction the loop runs

| | Scales? | Each case means something? |
|---|---|---|
| Model proposes, human approves | yes | degrades with volume |
| **Human proposes the behaviour, model expands it** | less | yes |

The second is what happened on day 11 by hand: *"try the memory features"* → a transcript → four defects. The human supplied the *behaviour worth testing*; the boilerplate around it was mechanical.

---

## What to build first, and it is not the generator

**Coverage analysis needs no taste at all:**

> *"Your PRD lists seven v1 jobs. Your suite covers three. Here are the four with no case, and the two policy rules with no violating case."*

That is arithmetic over two documents, fully checkable, and a fraction of the work. It also fails safely: a wrong coverage report is a wasted minute, whereas a wrong generated case is a green tick over a hole.

The second thing worth building is **expansion**: a person writes one line — *"a member declines a memory offer while holding a booking"* — and the tool produces the case, the turns, the assertions and the `runs` count. Human supplies judgement; machine supplies typing.

---

## The prediction, recorded so day 18 can falsify it

> Generated cases will find **fewer real defects per case** than hand-written ones by at least an order of magnitude — and the defects they do find will cluster on **specification compliance** (a policy rule not enforced) rather than on **interaction failures** (a bare "no" being read as a cancellation).
>
> Specifically: a generated set of 60–100 cases run against project 03 as it stands today will find **zero to two** defects that the seven hand-written cases do not already cover, and none of them will be of the kind that produced the day-11 findings.

If that is wrong — if generation finds interaction failures a human missed — then the objection above is wrong and this document should be rewritten rather than defended.

### How to test it fairly

Run the generated set against the agent **as it was before** the day-11 fixes, not after. A suite that cannot find already-fixed defects is not evidence about generation; it is evidence that the fixes worked.

---

## What is true regardless

Generated cases test that the agent matches its **specification**. They cannot test whether the specification is right — and on this project the specification has been wrong more often than the code has. Day 8 put "explain what membership includes" below the v1 line; day 9 discovered half that job was a tool call with exactly one right answer.

**No generator would have caught that, because it would have generated cases from the wrong line.**
