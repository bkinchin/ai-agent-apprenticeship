# Improvement Plan — Golf Club Member Agent

**Written:** day 14 · Prioritised by **(impact × frequency) ÷ effort**

Scored 1–5. *Impact* is what it costs when it goes wrong; *frequency* is how often the situation arises; *effort* is engineering days.

---

## Top 10

| # | Item | I | F | E | Score | |
|---|---|---|---|---|---|---|
| 1 | **Authenticate the member** | 5 | 5 | 3 | **8.3** | Launch condition |
| 2 | **Erasure for traces and the escalation queue** | 5 | 2 | 1 | **10.0** | Launch condition |
| 3 | **Enforce retention** — 30 days, then aggregates | 4 | 5 | 1 | **20.0** | Launch condition |
| 4 | **Somewhere to run it** — host, supervision, backups | 5 | 5 | 3 | **8.3** | Launch condition |
| 5 | **Notify the escalation queue** | 5 | 3 | 1 | **15.0** | |
| 6 | **Memory provenance report** | 3 | 4 | 1 | **12.0** | Longest detection time |
| 7 | **Shadow mode** | 5 | 5 | 2 | **12.5** | The evidence everything else needs |
| 8 | **Alert on a stale corpus** | 4 | 3 | 1 | **12.0** | Pre-mortem #2 |
| 9 | **Red-team injection via re-introduced text** | 4 | 2 | 1 | **8.0** | Untested category |
| 10 | **Measure the club's own error rate** | 3 | 5 | 2 | **7.5** | The PRD's own gap |

Ordered by score, the first fortnight is **3, 5, 7, 6, 8, 2** — the cheap ones with real consequences — with **1 and 4** running alongside because they are launch conditions regardless of score.

---

## The next two weeks

### Week 1 — the things that are cheap and currently absent

**Enforce retention (#3, half a day).** A scheduled job that deletes spans older than 30 days and rolls the rest into daily aggregates. The document already says this; today it is a claim. *Deletes personal data on a timer, which is the point.*

**Notify the escalation queue (#5, half a day).** An email to the team named in `escalation.yaml` when anything `immediate` is raised, and a morning digest of what is open. **The club asked for the digest on day 13 and it was the most-wanted thing on their list.** A bereavement currently waits in a SQLite file until somebody opens a terminal.

**Erasure (#2, one day).** `forgetEverything(memberId)` reaching memory, traces and the queue, reporting a count per store. Erasure is already solved for memory; this is the same shape twice more.

**Alert on a stale corpus (#8, half a day).** Fire when `corpusVersion` has not changed in eight weeks. Pre-mortem story #2 is a rule that changed at the club and not in the YAML, and **every metric stays green while that is true.**

### Week 2 — the evidence

**Shadow mode (#7, two days).** The agent runs on real enquiries; the output is recorded and **not shown**; a human answers as they do now; the two are compared.

This is the highest-value item on the list and it is not a control — it is **evidence**. It produces:
- Task success against real questions rather than cases I wrote
- **The club's own error rate**, which the PRD says nobody has measured, so accuracy stops being compared against an imagined 100%
- A picture of out-of-hours demand, the part of the business case nobody can currently size

**Memory provenance report (#6, half a day).** Every stored memory with its quote, age and confidence, in one page a human can skim. Wrong memories have **the longest detection time in the system** — weeks, and only if a member happens to ask. Day 11 proved a false memory contaminates the *retrieval query*, where every citation guarantee is blind to it.

**Then, in parallel and not finishing inside a fortnight:** authentication (#1) and somewhere to run it (#4). Both are launch conditions and neither is a two-week job done properly.

---

## Deliberately not in the top 10

**Retrieval / a vector database.** The corpus is ~8k tokens against a 40k trigger. `knowledge-retrieval.md` records five conditions for moving right and **none is met.** Cost is ~$16/year.

**Fixing the two remaining prompt-enforced behaviours** — looking up bookings it already has, and preferring `list_my_bookings` over `amend_booking`. Both cost a turn. Neither costs money or safety. They are annoyances competing against erasure and authentication.

**More conversational cases.** There are 18, they cost $0.30 a run, and **every one exists because a person found the defect first.** More cases written by me test more things I already thought of. Shadow mode buys real ones.

**A nicer console.** It is a CLI and it works. The exercise it was built for — reading a package as the manager — found five defects in ninety seconds, and none of them would have been fixed faster by a web page.
