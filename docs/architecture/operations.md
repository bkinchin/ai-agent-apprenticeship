# Operations

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 14

How to run it, stop it, and answer for it. Companion to [`runbook.md`](runbook.md), which covers the alerts.

> **Honest scope.** Today this runs from a terminal on one laptop. Everything below is written as though it were hosted, because that is the shape it needs — and the gap between this document and reality is itself a launch condition (`PRODUCTION_REVIEW.md`, operability: red).

---

## The kill switch

**A file, not a deploy.**

```bash
echo "tee sheet corrupt — do not book" > .agent-disabled
```

Effective on the **next turn**. No restart, no deploy, no engineer. Whoever is awake can do it.

Every member gets one sentence with the pro shop's real number and nothing else happens — no model call, no tool, no memory read. It is checked first in the turn, before the escalation checks, because the point is that *nothing* happens.

```bash
rm .agent-disabled     # back on, immediately
```

`AGENT_DISABLED=reason` also works and needs a restart, which is why the file exists.

> A kill switch that requires a deploy is not a kill switch. It is a plan to have one.

**Pull it when:** the tee sheet is returning wrong data, a policy violation has fired, a member reports something you cannot explain, or you do not know what is happening. **The cost of pulling it wrongly is one morning of phone calls.**

---

## Deploy and roll back

**Deploy is `git push` and a restart.** There is no pipeline. The pre-push hook runs the conversational suite (~$0.30, ~90s) and blocks on failure — it has already blocked one bad push.

**Roll back** is `git revert` and a restart. State survives: `.memory.db`, `.queue.db`, `.traces.db`, `.limits.db` and `.idempotency.json` are files on disk and are not versioned with the code.

**Which means a rollback does not undo data.** A bad release that wrote wrong memories leaves them there. Check `npm run trace` for the affected window and correct explicitly.

**Before deploying:** note the four version hashes from any recent trace header. If quality changes, that line is what you compare against.

---

## Daily

```bash
npm run console          open escalations, most urgent first
npm run metrics          the four families, and any firing alerts
```

**The escalation queue must be read every working day.** A bereavement escalates as `immediate` with a promise to the member — *"first thing tomorrow morning"* — and that promise is a commitment, not a queue priority.

Weekly:

```bash
npm run console roadmap  what the agent was missing, by volume
```

`knowledge` → write it down. `tool` → build it. `judgement` → correct, no action. **Sorted by volume, this is the product backlog.**

---

## A stuck escalation queue

**Symptom:** `npm run console` shows items older than their promised window.

1. Is anyone reading it? The commonest cause is nobody owning it.
2. `npm run console ESC-…` for each — the package carries what the agent did and what the member said.
3. Ring the member. **They were given a time; that promise is in the trace.**
4. Resolve each with the three questions. The second — *could the agent have handled it?* — is the only input the improvement loop has.

**If the queue is stuck because the file is unreachable:** the agent is still escalating and the member is still being told somebody will call. That is worse than the agent being off. **Pull the kill switch.**

---

## A data-subject request

**Access.** Everything held about one member:

```bash
npm run console                  their open and resolved escalations
npm run trace <sessionId>        every conversation, with full context
```

Memory is shown in their own words via the agent: *"what do you know about me?"*

**Erasure.** ⚠️ **Currently incomplete, and this is a launch condition.**

| Store | Erasure |
|---|---|
| `.memory.db` | ✅ `forget_everything` in conversation, reports a count |
| `.traces.db` | ❌ **none** — holds every word they have said |
| `.queue.db` | ❌ **none** — holds complaints and bereavements |
| Model provider | ❌ outside our control, subject to their retention |

**Answer honestly today: "mostly."** Do not claim erasure is complete. The traces are pseudonymised and PII-redacted at ingestion, which reduces the exposure and does not discharge the obligation.

**Retention** is documented as 30 days full then aggregates, and **nothing enforces it.** Improvement plan item #3.

---

## Rate limits

```
6  tool calls per turn         bounds parallel calls, which MAX_STEPS does not
25 tool calls per session
10 writes per member per hour
60 writes club-wide per hour   ← the runaway bound
```

Persisted in `.limits.db`, so they survive a restart — a limit that resets on restart is one an attacker resets by crashing the process.

**A member legitimately blocked** (a captain reorganising a competition day):

```bash
npx tsx -e "import {RateLimiter} from './src/core/limits.js'; new RateLimiter().clear('M-1001')"
```

**If the club-wide cap fires**, do not raise it. Something systemic is wrong and the right response is to stop. Pull the kill switch and look at `npm run metrics`.

---

## Backups

**There are none.** Four SQLite files hold the member's memories, the escalation queue, every trace and the rate-limit ledger. Losing `.queue.db` loses bereavements nobody has rung back.

`.idempotency.json` is the sharpest one: losing it means a retried write can double-book, because the client store is the *only* protection — the tee sheet has no idempotency keys and never will.

Improvement plan item #4.

---

## Who does what

| | |
|---|---|
| **Accountable for agent behaviour** | Pro Shop Manager (PRD §0) |
| **Reads the escalation queue** | ⚠️ **unassigned** |
| **On call** | ⚠️ **nobody** |
| **Can pull the kill switch** | Anyone with terminal access — deliberately |
| **Decides to pull it** | ⚠️ **unagreed** |

Three of five are open, and naming an owner is necessary rather than sufficient. `PRODUCTION_REVIEW.md`, governance: amber.
