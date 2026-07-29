# Day 14 — Production Review

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can run a production readiness review on an agent system — including your own — and produce a go/no-go recommendation you would put your name to.

No new concepts today. Today you apply everything, adversarially, to what you have built.

---

## Concepts

### The readiness question

Not "does it work?" but: **"do we understand how it fails, and can we live with that?"**

Every agent will act wrongly at some point. Readiness is about whether the wrong actions are bounded, detectable, reversible, and survivable.

### The review dimensions

| Dimension | The question | Fails if |
|---|---|---|
| **Correctness** | Does it do the job? | No measured baseline exists |
| **Safety** | What's the worst it can do? | Unbounded or irreversible actions |
| **Reliability** | What happens when things break? | Untested failure paths |
| **Security** | Can it be manipulated? | No red-teaming performed |
| **Privacy** | Is personal data handled properly? | No erasure path |
| **Observability** | Can we debug it? | Can't reconstruct a conversation |
| **Operability** | Can we run it? | No runbooks, no owner |
| **Economics** | Does it pay for itself? | Cost per resolution unknown |
| **Governance** | Who is accountable? | Nobody named |

**Nine dimensions. Most teams review one.**

### Pre-mortem

The most valuable 30 minutes in the review. Assume it is six months from now and the project has failed publicly. Write the story.

Typical results, which you should expect to rediscover:

- An edge case in the data caused wrong bookings for a fortnight; nobody noticed because containment looked fine
- Cost per conversation tripled after the corpus grew; nobody was watching cost
- A model update changed behaviour subtly; no version stamping, so it took two weeks to identify
- Escalations went to a queue nobody owned; members waited days
- A prompt injection in a member's complaint text caused disclosure of another member's details

Write the story *first*, then work backwards to the control that would have prevented it. Half of these will be things you have not built.

### Blast radius

For every write tool, complete this table:

| Tool | Worst single error | Worst systematic error | Detection time | Reversible? | Bound |
|---|---|---|---|---|---|
| `confirm_booking` | One wrong slot | Tee sheet corrupted for a weekend | Minutes (member calls) | Yes | Rate limit + allowance check |
| `cancel_booking` | Wrong cancellation | Mass cancellation | Hours | Partially | Confirmation + daily cap |
| `enter_competition` | Ineligible entry | Competition invalidated | Days ← **worst** | Yes, embarrassingly | Handicap check + cap |

The column that matters most is **detection time**. A reversible error found in minutes is a non-event. A reversible error found in a fortnight is a crisis. Rank your risks by detection time, not by severity.

**Every write tool needs a rate limit.** Not because you expect a runaway, but because the cost of the limit is zero and the cost of its absence is unbounded.

### The launch decision

Options are not binary:

| Option | Description | When |
|---|---|---|
| **Internal only** | Staff use it as an assistant | Always the right first step |
| **Shadow** | Runs on real traffic, output not shown, compared to humans | Best evidence, zero risk |
| **Read-only** | Answers questions, cannot act | Establishes trust |
| **Assisted** | Proposes actions, human approves | High-stakes writes |
| **Limited** | 10% of members, or one job only | Bounded exposure |
| **Full** | Everyone, all jobs | After the above |

Shadow mode is underused and is the strongest evidence you can gather. Recommending it is a strong interview signal.

---

## Exercise

Today is a review of `projects/03-golf-club-agent/`, conducted seriously.

**1. Complete the readiness checklist** — all nine dimensions, in `projects/03-golf-club-agent/PRODUCTION_REVIEW.md`. Score each red / amber / green with evidence. **Evidence means a link to a test, a metric, or a document — not an assertion.**

**2. Run the pre-mortem.** Six failure stories, minimum. Working backwards from each to the missing control.

**3. Build the blast radius table** for every write tool, including detection time.

**4. Implement rate limits** on every write tool. Per session, per member, per hour globally.

**5. Red-team for a full hour.** Not 10 minutes. Categories: prompt injection (including via retrieved documents and via free-text fields that end up in context); authorisation bypass; policy circumvention; cost attacks (make it loop, make it retrieve everything); data extraction (get it to reveal another member's information); social engineering. **Log every attempt and its outcome.**

**6. Run the full evaluation suite** and record the honest numbers: task success by job, policy violations (must be zero), escalation rate, cost per conversation, cost per resolution, p95 latency.

**7. Write the failure analysis** — `projects/03-golf-club-agent/FAILURE_ANALYSIS.md`. Every known failure mode, categorised by root cause (prompt / tool / workflow / policy / knowledge / model limitation / integration), with frequency and mitigation. **Be honest. The value of this document is proportional to its discomfort.**

**8. Write the improvement plan** — `projects/03-golf-club-agent/IMPROVEMENT_PLAN.md`. Prioritised by (impact × frequency) ÷ effort. Top 10 items. Say what you would do in the next two weeks.

**9. Write the operations runbook:** how to deploy, roll back, silence the agent entirely (a kill switch — do you have one?), handle a stuck escalation queue, respond to each alert, and handle a data-subject request.

**10. Make the recommendation.** One page. Go / no-go / go-with-conditions, with named conditions and the evidence behind them. Sign it.

**11. Have it challenged.** Ask Claude to review your recommendation as a sceptical CTO whose bonus depends on nothing going wrong. Address the strongest three objections in the document.

---

## Deliverable

- [ ] `PRODUCTION_REVIEW.md` — nine dimensions, RAG-scored, with evidence
- [ ] Pre-mortem with ≥ 6 stories and the controls each implies
- [ ] Blast radius table with detection times
- [ ] Rate limits on every write tool
- [ ] One-hour red-team log
- [ ] Honest evaluation numbers including cost per resolution
- [ ] `FAILURE_ANALYSIS.md`
- [ ] `IMPROVEMENT_PLAN.md` — prioritised top 10
- [ ] Operations runbook, including a kill switch
- [ ] Signed one-page recommendation
- [ ] `journal/day-14.md` — week-2 retrospective + self-assessment update

---

## Reflection

1. Which dimension scored worst? Were you avoiding it, and why?
2. What did red-teaming find that you genuinely did not expect?
3. Which failure mode has the longest detection time? What monitoring closes that gap?
4. Would you personally sign off on this going live to real members? If not, name the three things that would change your answer.
5. **Week-2 retrospective:** you have built a real vertical agent. What was harder than expected? What was easier? What does that tell you about where the difficulty in this field actually lies?

---

## Interview Question

> "You're the engineering lead. The business wants to launch the agent to all customers next Monday. Your evaluation shows 91% task success. What do you say?"

The number alone is meaningless and a strong candidate says so: 91% of *what*, measured on which cases, and what happens in the other 9%? Nine percent of failures that escalate cleanly is a fine product; nine percent that take wrong actions against systems of record is not. Then: what's the human baseline (staff might be at 93%, which reframes everything), what's the blast radius, what's the detection time, is there a kill switch, who is on call. And rather than a flat no, propose the staged path — shadow mode this week, read-only to 10%, then expand on evidence. Someone who says either "yes, 91% is great" or "no, not until 99%" has not understood the question.

---

**Week 2 complete.** You have a production-reviewed vertical agent, honestly assessed. Update `journal/self-assessment.md` before starting week 3.

**Next:** [Day 15 — Agent architecture patterns](../week-03/day-15.md)
