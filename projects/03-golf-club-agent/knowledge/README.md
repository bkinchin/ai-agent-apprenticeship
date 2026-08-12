# Knowledge corpus — and its deliberate defects

Two directories:

| | Contents | How the agent uses it |
|---|---|---|
| `structured/` | Every fee, limit, date and threshold | **Tools.** Bypasses retrieval entirely. |
| `knowledge/` | Narrative — rules that need judgement, procedures, the "why" | Retrieved and cited. |

**The split rule:** could two reasonable people read this and disagree about the answer? No → structured. Yes → narrative.

---

## Defects planted on purpose

Real corpora contain all of these. An agent that has only seen a clean corpus meets its first contradiction in production, in front of a member.

| # | Type | Where | Correct behaviour |
|---|---|---|---|
| 1 | **Stale prose vs live data** | `membership-handbook.md` says guests are **$15**; `fees.yaml` says **$20** (raised 2026-04-01) | Use the tool. Never quote the prose figure. |
| 2 | **Authority conflict** | Denim: `dress-code.md` (Pro Shop) bans it on club premises; `bar-and-clubhouse.md` (Bar Manager) allows it in the spike bar | Surface both, **name the owner**, do not resolve |
| 3 | **Closing-time conflict** | `bar-and-clubhouse.md` says the bar closes 11pm Fri–Sun; `faq.md` says "the club closes at 10:30" | Same — different owners, different jurisdictions |
| 4 | **Total gap** | Dogs. Mentioned nowhere. | **Abstain.** Do not invent a policy. |
| 5 | **Partial gap** | Junior membership is referenced in the handbook but its conditions are never stated (fees exist in YAML; eligibility does not exist anywhere) | Give what exists, flag what doesn't |
| 6 | **Undefined load-bearing word** | "Smart" shorts, `dress-code.md`. Does all the work, defined nowhere. | Quote the rule, acknowledge the ambiguity, name who decides |
| 7 | **Staleness** | `competition-rules.md` last updated 2023 and describes a handicap system that changed | Flag the date rather than quoting it as current |

### Why #2 and #3 are the interesting ones

They are not contradictions. **Neither document is wrong.** The bar manager and the pro shop both have legitimate authority over dress and hours — in different parts of the club — and the corpus never states who wins where.

That is what real organisations look like, and an agent that resolves it silently is confidently answering a question nobody at the club has actually settled.

Every document therefore carries an `owner` in its front matter, so the agent can name who decides instead of guessing.

---

## Baseline: prompt stuffing

Measured 2026-08-10, `claude-haiku-4-5`, whole corpus in the system prompt, structured data exposed alongside it as authoritative.

```
accuracy         20/20  (100%)  three consecutive runs
invention rate   0/15           across all three runs
bad citations    0
cost             $0.0079 per question  (~7.2k input tokens)
```

Reached in three steps, and the middle one is the interesting part.

| | Accuracy | Invention |
|---|---|---|
| First measurement | 19/20 worst of 3 | 0/15 |
| After "state authoritative values plainly" | 17–18/20 | **1/5, three runs running** |
| After scoping that instruction precisely | **20/20 × 3** | **0/15** |

**Manual use found a fault the eval could not.** Asked the guest fee, the agent gave the authoritative $20 and then added *"may have changed, check with the pro shop"* — because `faq.md` says so. It had a certain answer and made it sound uncertain. No assertion in the suite catches that; it looks like a pass.

**Fixing it caused a regression, measured.** Told to state values plainly, the model generalised to confidence in general and began answering *"can I hire the clubhouse for a wedding?"* with the private-hire policy. Consistent across three runs, always the same question — which is what made it diagnosable rather than dismissable as noise.

The fix was precision, not reversal: scope the confidence instruction to structured values only, and add an explicit rule that **adjacent is not an answer**.

> A prompt change is not local. The only way to know what else it moved is to measure.

**Invention rate is the number that matters.** Fifteen opportunities to answer a question the corpus cannot answer — dogs, weddings, an electric-bike charger, a visitor green fee that exists one file away — and it declined every time. That is the whole reason the `not_in_knowledge_base` branch exists.

### Both failures were the test, not the agent

Across three runs the two misses were: citing `faq.md` for a rule the FAQ genuinely restates, and phrasing "three hours fifteen" in a way my string list did not anticipate.

That is the fourth time on this project that a failing case turned out to be a brittle assertion. Worth stating as a property rather than fixing a fifth time:

> The **source** assertion is robust. The **content** assertion is brittle.

Deterministic checking on generated text works well for *where it came from* and poorly for *what it said*. Cite-checking is the load-bearing assertion here; string matching on the answer is a smoke test.


---

## Four defects found by one manual session

The eval was passing 20/20, three runs running, when a person sat down and typed at the agent. It found four things the suite could not see.

### 1. A stale document beat the authoritative data — on a booking rule

```
booking-rules.yaml   (authoritative)  every Saturday 08:30-11:00
competition-rules.md (STALE, 2023)    first and third Saturdays only
```

The agent used the stale document and told a member the 2nd and 4th Saturdays were bookable. They are not. **This is a booking error on the highest-blast-radius job in the PRD**, and it is the exact failure the structured/unstructured split exists to prevent.

The mechanism is the interesting part:

> **Specificity beat authority.** "First and third Saturdays" is detailed and confident. "saturday" is terse. The model trusted the one that sounded better informed — and detail is precisely what goes stale first.

Fixed at the corpus, not the prompt: the window is now stated **once**, in the authoritative place. The principle that decided it — *eliminate conflicts where the blast radius is high; keep them where you want to test judgement.* A wrong guest fee is a conversation. A wrong booking rule is a member driving to a closed tee sheet.

### 2. YAML comments are invisible to the model

The file said:

```yaml
competition:
  # Tee sheet closed to general booking during these windows
  - day: saturday
```

The parser drops comments. The model saw `{"day":"saturday","from":"08:30","to":"11:00"}` and could not tell whether that was when competitions *happen* or when booking is *shut*.

**Documentation written for a human reading the file is not read by the model, which sees the parsed file.** Every YAML now carries its meaning *in the data* — a `meaning:` key rather than a `#` comment.

This was systemic: `fees.yaml` explained that the guest fee was "per guest, per round" and had been raised from 15, in comments. Both invisible.

### 3. The `suggestion` field was an uncited escape hatch

Citations are required on `answer`. Nothing was required on `suggestion` — so an abstention could still deliver facts, unsourced and unverified, through the branch designed to be the safe one.

Now constrained to routing (*who* to ask and *what* to ask them), with a `contact` enum, and the eval flags any suggestion containing a figure.

### 4. Staleness never reached the member

The prompt asked the model to mention that a source was overdue for review. It did not — it answered a booking question from a 2023 document and said nothing.

Moved to code: the cited sources are checked against their review dates and the warning is appended by the runner. **Asking a model to remember something is a request; computing it is a guarantee.**

---

## Seven assertion errors, and what they mean

Across day 9 the eval was wrong about the agent **seven times**:

| # | The assertion | Why it was wrong |
|---|---|---|
| 1 | `expectAbsent: ["15"]` on the guest fee | Failed the *best* answer ("$20; the handbook says $15 and is stale") as well as the worst |
| 2 | Bar hours must cite `bar-and-clubhouse.md` | `hours.yaml` is authoritative and citing it is better |
| 3 | Live bookings must cite `booking-rules.yaml` | The FAQ legitimately restates the rule |
| 4 | Denim question asked "in the spike bar" | Too specific — the conflict only surfaces on the unqualified question |
| 5 | Denim answer must say "bar manager" | The jurisdictions partition cleanly; there is nothing to decide |
| 6–7 | Pace of play must contain one of *n* phrasings | Widened to seven variants, still missed "three hours **and** fifteen minutes" |

The last one is the conclusion, not the anecdote:

> **You cannot enumerate the ways a sentence can be phrased.** Seven attempts, on a single fact with one correct value.

So the harness now splits its assertions the way day 7 split judging:

| Assertion | Deterministic? | Treatment |
|---|---|---|
| Cited the right source | yes | **gate** |
| Abstained when it should | yes | **gate** |
| Citation quote verifies | yes | **gate** |
| Quoted a value it should not | yes | **gate** |
| Answer contains a phrase | **no — 7/7 wrong** | **report** |

Gating on a fuzzy signal is how a suite gets switched off. Reporting it keeps the information without letting it lie.

## Baseline after the fixes

```
accuracy         20/21  worst of three runs — 20, 21, 20
invention rate   0/15   across all three runs
bad citations    0-1
cost             $0.0086 per question
```
