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
