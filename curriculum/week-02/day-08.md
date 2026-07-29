# Day 8 — Product Requirements and Jobs-to-be-Done

> Week 2 · Enterprise agent · Project: [03-golf-club-agent](../../projects/03-golf-club-agent/)

## Objective

You can turn a vague business request into an agent specification that an engineering team could build from and a business owner would sign.

This is your existing strength applied to a new medium. Do not skim it — agent PRDs differ from software PRDs in ways that matter.

---

## Concepts

### Why agent PRDs are different

A traditional PRD specifies behaviour. An agent PRD must additionally specify:

- **What the agent must never do** — the failure boundary, not just the happy path
- **How wrong is too wrong** — an accuracy target, because 100% is not available
- **What happens when it can't** — escalation is a first-class product surface, not an error path
- **How you'll know it works** — evaluation criteria, in the PRD, before a line of code
- **Who is accountable** when it acts incorrectly

That last one is the question that ends the meeting. Ask it early.

### Jobs-to-be-done, applied to agents

Don't start from "what should the AI do?" Start from **what is the customer trying to get done, and what does progress look like to them?**

For the golf club:

| Job | Frequency | Current cost | Agent fit |
|---|---|---|---|
| "Book a tee time that suits my group" | Daily | Phone call, 4 min | **High** — clear tools, checkable |
| "Understand what my membership includes" | Monthly | Email, 1 day wait | **High** — knowledge retrieval |
| "Renew without thinking about it" | Annual | Letter + call | Medium — payment = risk |
| "Complain about course condition" | Rare | Email, often ignored | Medium — needs judgement + routing |
| "Find out if the competition is on in this weather" | Weather-driven | Call the pro shop | High — but needs live data |
| "Dispute a charge on my account" | Rare | Escalates anyway | **Low** — go straight to human |

Note the last row. **Deciding what the agent will not do is product work of equal value.** An agent that does five jobs excellently beats one that does fifteen adequately — because the five are trusted.

### The agent capability matrix

For every job, specify five things:

```
Job:            Book a tee time
Trigger:        "Can I get a slot Saturday morning?"
Information:    member ID, party size, date, time window, handicaps
Tools:          check_availability, hold_slot, confirm_booking, get_member
Success:        Booking exists in the tee-sheet; member has a reference
Failure modes:  No availability · member's allowance exhausted ·
                guests exceed policy · competition closes the sheet
Escalation:     Member disputes a policy decision · booking conflicts
Accuracy bar:   99% — a wrong booking is visible and embarrassing
Reversibility:  Reversible (cancel within 24h) → lower confirmation burden
```

The **reversibility** line drives more design than anything else on the list. Reversible actions can be more autonomous. Irreversible ones need confirmation, audit, and often a human.

### Setting an accuracy bar honestly

"It must be accurate" is not a requirement. Do this instead:

1. **Measure the human baseline.** Staff get things wrong too. Nobody has ever measured it, and the number is usually 92–97%.
2. **Set the bar relative to that baseline**, per job. Booking: 99%. Answering a fees question: 95% with citation. Complaint routing: 90% with escalation on doubt.
3. **Define the cost of each error type.** False booking vs. missed booking are not equally bad.
4. **Decide the containment target** and pair it with a quality measure.

"Better than the current phone experience, measurably, on these five jobs" is a requirement you can ship against. "Accurate" is not.

### Scoping: the three questions

1. **Volume × cost** — is this job frequent and expensive enough to matter?
2. **Checkability** — can you tell whether the agent got it right? If not, you cannot evaluate it, so you cannot improve it. Deprioritise.
3. **Blast radius** — what's the worst outcome of getting it wrong 1% of the time?

High volume + checkable + small blast radius = build first. That is where every successful agent programme starts.

---

## Architecture

Your PRD must include an **integration inventory**, because it determines feasibility more than any model choice:

| System | Owner | Access | Latency | Write? | Risk |
|---|---|---|---|---|---|
| Tee-sheet (BRS) | Ops | REST | 200 ms | Yes | Double-booking |
| Membership CRM | Membership sec. | REST | 500 ms | Read only | PII |
| Handbook / rules | Club | PDF | n/a | No | Staleness |
| Competition calendar | Comp. sec. | Google Cal | 1 s | No | Timezone |
| Payments | Finance | Stripe | 1 s | **No — out of scope** | Money |

Two lessons emerge every time you do this exercise:

1. **The hardest problems are integration and data quality, not AI.** If the tee-sheet API has no idempotency, that is your project risk.
2. **Excluding a system is a design decision** worth stating explicitly, with its rationale.

---

## Exercise

**1. Write the full PRD** for the Golf Club Agent in `projects/03-golf-club-agent/PRD.md`, using `templates/PRD_TEMPLATE.md`.

**2. Interview the business.** You don't have a real club, so construct it: write 10 questions you would ask the club manager, then answer them as a plausible manager would. Include the awkward ones — "what happens today when a booking goes wrong?", "who gets the complaint?", "what's the one thing that must never happen?"

**3. Build the job map.** At least 8 jobs, scored on volume, checkability, and blast radius. **Rank them and draw the line.** Everything below the line goes in an explicit "not in v1" section with a reason.

**4. Write capability specs** for the top 4 jobs, using the five-part format above.

**5. Build the integration inventory.** Include one system you deliberately exclude, and say why.

**6. Define success metrics** — 5 to 7, each with a baseline, a target, and a measurement method. If you can't say how it's measured, it's not a metric.

**7. Write the anti-requirements.** A numbered list of things the agent must never do. This section will be the most-read part of the document. Aim for 10.

**8. Write the escalation design** as product, not as error handling: what triggers it, what the member sees, what the human receives, what the SLA is.

**9. Sanity-check it.** Hand the PRD to Claude and ask it to argue that the project should not be approved. Address the strongest objection in the document.

---

## Deliverable

- [ ] `projects/03-golf-club-agent/PRD.md` — complete, from the template
- [ ] Job map with ≥ 8 jobs, ranked, with an explicit v1 line
- [ ] 4 capability specs
- [ ] Integration inventory with one justified exclusion
- [ ] 5–7 measurable success metrics with baselines
- [ ] ≥ 10 anti-requirements
- [ ] Escalation design
- [ ] `journal/day-08.md`

---

## Reflection

1. Which job has the highest value and the lowest checkability? How do you handle that tension?
2. What is the single most dangerous action in your design? What would you require before shipping it?
3. You have a containment target. What is the perverse incentive it creates, and what metric do you pair it with?
4. The club manager says "can it just do everything the receptionist does?" Write the answer you'd give — in three sentences, without being dismissive.
5. Where does this PRD differ most from a PRD you have written for conventional software?

---

## Interview Question

> "A retailer wants a customer-service agent. How do you scope v1?"

Look for: jobs-to-be-done rather than feature lists; ranking by volume × checkability × blast radius; a clear v1 line with explicit exclusions; separating read-only jobs (ship first) from write jobs (ship carefully); measuring the human baseline before setting a bar; escalation designed as product; and anti-requirements. The strongest answers name what they would *cut* and why, and mention that the first release should be deliberately narrow so trust can be established before scope grows.

---

**Next:** [Day 9 — Knowledge systems](day-09.md)
