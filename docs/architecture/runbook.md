# Runbook

**Status:** in use · **Project:** `03-golf-club-agent` · **Written:** day 13

One entry per alert. **An alert without a runbook entry is noise, and noise trains people to ignore alerts** — including the one that mattered.

Each entry: what you saw, what usually causes it, the first three things to check, and what to do now.

---

## Before any entry: the two questions

**1. Did anything change?** Every span carries `model`, `prompt`, `policy` and `corpus` version hashes. Compare a failing trace with a good one from last week:

```bash
npm run trace <bad-session>    # header line has all four
npm run trace <good-session>
```

For an agent, *"nothing was deployed"* is almost never true. The model changes underneath you, the corpus changes, the supplier changes — and none of that touches the repository. **The version that differs is where you start.**

**2. Can you see it?** If the trace store is empty, fix that first — you are otherwise about to debug by guessing.

---

## `bad_citations` · CRITICAL · agent-owner

**Symptom.** An answer cited a source, and the quoted value could not be found in it.

**Usual cause.** Not the model. Four times out of four on this project it was **the detector**: the needle and the haystack normalised differently. Once it compared `JSON.stringify(x)` against a prompt built with `JSON.stringify(x, null, 2)`; once it demanded a digit and rejected `"currency": "AUD"`; once a quoted token carried its own delimiters against a YAML folded block ending in a newline.

**First three checks.**
1. `npm run trace <session> full` — read the actual citation and the actual source text.
2. Reproduce it against `verifyCitations` directly. If it does not reproduce, the corpus changed between the run and now.
3. Compare `corpusVersion` on the failing span against the current corpus hash.

**Mitigation.** If the citation is genuinely invented, that is a model or prompt regression — check `promptVersion` and roll back. If the detector is wrong, fix the detector: **a check that reports failures it cannot substantiate is worse than no check**, because ignoring it is the correct response and then nobody reads the real ones.

---

## `escalation_rate_spike` · HIGH · agent-owner

**Symptom.** Escalations up more than 50% against the prior week.

**Usual cause.** Something changed in the world, not in the code — a competition added, opening hours moved, a supplier degrading.

**First three checks.**
1. `npm run metrics` — look at `escalationsByReason`. A spike in ONE reason is a specific cause; a spread is a general one.
2. `npm run console roadmap` — what humans said was missing when they resolved them.
3. Compare `corpusVersion` and `policyVersion` against last week.

**Mitigation.** By reason: `knowledge` → write the answer down; `tool` → the agent needs a capability; `judgement` → correct, and no action; `out_of_scope` → a PRD decision working as intended. **A spike in `knowledge` is a backlog item, not an incident.**

---

## `steps_per_conversation` · HIGH · agent-owner

**Symptom.** Tool calls per conversation up 50%. **The earliest leading indicator on the board** — the agent is struggling before it is failing.

**Usual cause.** A tool returning less than it used to (a filter too aggressive, a supplier trimming results), so the model retries and re-asks. Or a prompt change that made an instruction ambiguous.

**First three checks.**
1. `npm run metrics` — which tool's count grew?
2. `npm run trace <session>` on a long one. Look for the same tool called repeatedly with near-identical arguments.
3. Check `deniedRate`. A guard that started over-firing looks exactly like this.

**Mitigation.** If a guard is over-firing, that is a regression — the guards are supposed to be quiet. Day 12 shipped one where every Monday was read as a Sunday; **a guard that mangles correct input is worse than no guard.**

---

## `cost_per_conversation` · HIGH · agent-owner

**Symptom.** Cost doubled against baseline with flat volume.

**Usual cause.** Almost always the context growing — the corpus gained a file, or memory is injecting more than it should. Occasionally a model change underneath you.

**First three checks.**
1. `npm run metrics` — is `tokensPerConversation` up, or is it `stepsPerConversation`? Different problems.
2. `npm run trace <session> full` — read the system prompt on an `llm` span and see what got bigger.
3. Compare `corpusVersion`. The knowledge eval went $0.19 → $0.23 on this project purely from two YAML files being added.

**Mitigation.** Corpus growth is expected and cheap up to the trigger in `knowledge-retrieval.md` (~40k narrative tokens). **Cost rising on flat volume always means something** — but the something is usually benign, and the point of the alert is that you looked.

---

## `loop_detection` · MEDIUM · agent-owner

**Symptom.** More than 5% of conversations hit the same-call-three-times guard.

**Usual cause.** The agent stuck on a fact it cannot get — a tool returning empty where it used to return data.

**First three checks.**
1. `npm run trace <session>` — the repeated call and its arguments are the answer.
2. Is the tool erroring, or succeeding with nothing? `toolErrorRate` distinguishes them.
3. Did the arguments come from the member, or did the model invent them?

**Mitigation.** A loop is the agent telling you a capability is missing. It escalates correctly, so this is a **backlog signal rather than an incident** — unless the rate is climbing, which means it is now systematic.

---

## `tool_error_rate` · HIGH · agent-owner

**Symptom.** One tool failing more than 5% of calls.

**Usual cause.** The supplier. The tee sheet is a Google Sheet that staff edit all day.

**First three checks.**
1. Which tool, and is it reads or writes? A failing read is an annoyance; a failing **write** may have landed.
2. Has the circuit breaker tripped? Check for `unavailable` outcomes clustering in time.
3. `npm run trace` on a failure — `transient: true` means an outage, `false` means a fact about the request.

**Mitigation.** Transient errors are handled by the client's retry policy and degraded mode. **Non-transient ones are a contract change** and need the supplier. Check `.idempotency.json` for keys stuck at `pending` — those are writes whose outcome is unknown and nobody is chasing.

---

## `urgent_escalation_waiting` · CRITICAL · **pro shop**

**Symptom.** A member has been escalated for bereavement or distress.

This is the only alert on this list whose audience is the pro shop, and the only one that ends in a phone call rather than a dashboard.

**What to do.** Ring them. `npm run console` shows the queue with the most urgent first; the package carries what the agent did and what the member said.

**Do not** send them back to the agent — the conversation is halted deliberately, and it stays halted.

**Escalate further if.** Nobody has picked it up within the promised window. The promise the member was given is in the trace and in the queue entry; it is a commitment, not a queue priority.

---

## What has no alert, deliberately

**Task success.** Lagging, and by the time it moves you have already lost members. It belongs in the weekly digest.

**Abstention rate.** The knowledge branch declining is the safe branch working. It is worth *watching* — a sudden change means the corpus or the questions moved — but not worth interrupting anyone for.

**The morning schedule.** The club's most-wanted item, and it is **not an alert**. It is a digest, read with a coffee, and it would actually get read. **Alerts interrupt; digests inform.** Conflating them is how people end up ignoring both.
