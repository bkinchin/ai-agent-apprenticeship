# Day 21 — Final Demo and Interview Preparation

> Week 3 · Agent platform · All projects

## Objective

You can demonstrate what you built, explain the decisions behind it, and hold a senior technical conversation about enterprise agent engineering.

Everything is built. Today you make it communicable — because work you cannot explain does not count.

---

## Concepts

### What you are actually demonstrating

Not "I built an agent." Anyone can. You are demonstrating:

- You understand agents from **first principles**, not framework tutorials
- You think about **failure before features**
- You can **measure** agent quality, which most people cannot
- You understand the **commercial** context — cost, risk, accountability
- You built a **platform**, which is a different order of thinking from an app

The Agent Factory is the headline. It says: I understood the domain well enough to abstract it.

### Demo structure — 10 minutes

| Time | Section | Content |
|---|---|---|
| 0:00 | **The problem** | A business process, its cost, why it's a fit |
| 1:00 | **The agent working** | Golf club agent, happy path. Live. |
| 3:00 | **The agent refusing** | Policy denial + escalation. **This is the important bit.** |
| 4:30 | **Under the hood** | The trace. Show tools, policy decisions, cost. |
| 6:00 | **How you know it works** | Evaluation dashboard, real numbers, honest failures |
| 7:30 | **The factory** | New spec → generated agent → running |
| 9:00 | **What you'd do next** | The improvement plan, honestly |

**The refusal is the part that separates you.** Everyone demos the happy path. Demoing the agent correctly declining to act, escalating with full context, and explaining itself to the customer shows you understand what production means.

Show the trace. Show the eval numbers *including the failures*. Confident honesty about a 94% pass rate beats a demo that implies 100%.

### Demo discipline

- **Rehearse it three times.** Time it.
- **Record a backup video.** Live demos fail; the API will rate-limit you at the worst moment.
- **Pre-seed the data.** Don't type customer IDs on stage.
- **Have the failure case ready** — if something breaks live, narrate it as an example of why observability matters and pull up the trace. This can be the strongest moment of the demo.
- **Know your numbers cold.** Cost per conversation. Pass rate. Escalation rate. Time to generate an agent.

### The interview conversation

Senior interviews probe **depth on tradeoffs**, not recall. The pattern is: a question, then three follow-ups going deeper. Recall gets you through the first. Only experience gets you through the third.

The reliable structure for any answer:

1. **Clarify** — "What's the blast radius? Is the action reversible?"
2. **Take a position** — not a survey of options
3. **Name the tradeoff** — what your choice costs
4. **Give the evidence** — how you'd know you were right
5. **Say what would change your mind**

Point 5 is what marks out a senior engineer. Certainty without conditions reads as inexperience.

### Your differentiating positions

You have earned specific, defensible opinions. Have them ready:

| Position | Because |
|---|---|
| Prompts are guidance; code is enforcement | Day 6 — you red-teamed your own prompt-based rules and broke them |
| Most enterprise agents are state machines, not autonomous loops | Day 5 — ordering and preconditions are business requirements |
| Start with prompt stuffing, not a vector database | Day 9 — you measured both on the same questions |
| Tool design dominates agent reliability | Day 3, day 10 — the model is the part you don't control |
| Escalation is a feature; zero escalation is a warning sign | Day 12 |
| Multi-agent is a scaling decision, not a starting architecture | Day 15 — you measured the cost |
| Fix at the lowest layer, not in the prompt | Day 19 — the layer table |
| Idempotency is the first question about any write tool | Day 10 — you built the ambiguous-timeout case |
| Containment without a quality pair is a vanity metric | Day 7 |

Each is backed by something you built and measured. That is the difference between an opinion and a position.

### Questions to ask them

Interviews are two-way, and your questions reveal your level:

- "How do you evaluate your agents today? What's your golden set look like?"
- "What's your escalation rate, and what do you do with the reasons?"
- "How do you handle a model version change?"
- "Where do you enforce policy — prompt or code?"
- "What's the worst production incident you've had with an agent?"
- "Who is accountable when an agent takes a wrong action?"

The last one tells you a great deal about the organisation's maturity.

---

## Exercise

**1. Write the demo script.** Beat by beat, timed to the table above.

**2. Prepare the environment.** Seeded data, pre-warmed connections, a clean terminal, browser tabs in order.

**3. Rehearse three times, out loud, timed.** Not in your head.

**4. Record the backup video.**

**5. Build the portfolio README** — rewrite the root `README.md` so a hiring manager landing on the repo understands in 60 seconds what you built and why it is serious. Screenshots or diagrams of: the state machine, a trace, the eval dashboard, the factory pipeline.

**6. Write the 21 interview answers.** In `docs/interview-preparation/answers.md`, write out your answer to each day's interview question — properly, in prose, as you would say it. The act of writing is the preparation.

**7. Prepare your positions.** For each row in the table above, write one paragraph: the position, the evidence from your own work, and what would change your mind.

**8. Do a mock interview.** Have Claude interview you as a Sierra/enterprise-AI hiring manager: three questions, each with three escalating follow-ups. **No preparation, no notes.** Record where you ran out of depth.

**9. Fix the gaps.** Whatever you couldn't answer in step 8 is your genuine weak spot. Go back to that day's material.

**10. Do a second mock** on the topics you failed.

**11. Write the case study** — `docs/interview-preparation/case-study.md`. Two pages on the golf club agent: problem, architecture, key decisions and their alternatives, results with real numbers, failures, and what you would do differently. This is the document you send before an interview.

**12. Final self-assessment.** Score all of `SUCCESS_CRITERIA.md`. Be honest. Anything below 4 is your next fortnight.

---

## Deliverable

- [ ] Timed, rehearsed 10-minute demo
- [ ] Backup recording
- [ ] Portfolio-quality root README with diagrams
- [ ] `docs/interview-preparation/answers.md` — all 21 questions answered in prose
- [ ] Positions document with evidence and change-my-mind conditions
- [ ] Two mock interviews completed, with gaps identified and closed
- [ ] `docs/interview-preparation/case-study.md`
- [ ] Final scores in `journal/self-assessment.md`
- [ ] `journal/day-21.md` — the full retrospective

---

## Reflection

1. Where did the mock interview run out of depth? Have you actually fixed it, or just read about it again?
2. Which of your positions is weakest — where are you repeating something you read rather than something you measured?
3. What would you build differently if you started the golf club agent again on day 8?
4. What is the most commercially valuable thing you learned in 21 days? Not the most interesting — the most valuable.
5. What are you still not confident about? Name it precisely. That is your next project.

---

## Interview Question

> "Tell me about something you built."

The whole apprenticeship compressed into three minutes. Structure: the business problem and why an agent fits it; the architecture and the two or three decisions you would defend; how you knew it worked, with numbers; the most interesting failure and what it taught you; and what you would do differently. Lead with the problem, not the technology. Include a real failure — candidates who present flawless projects are either not being honest or were not close enough to the work. And be ready for the follow-up on any number you state, because it will come.

---

## Beyond day 21

You have the foundations. What extends them:

- **Ship one of these to real users.** Nothing in this repository substitutes for that.
- **Voice** — latency budgets, interruption handling, and ASR errors change the design considerably.
- **Evaluation at scale** — human review pipelines, annotation quality, inter-rater agreement.
- **Fine-tuning** — when a prompt genuinely isn't enough, and how to tell.
- **Multi-tenant platforms** — isolation, per-tenant policy, noisy neighbours.
- **The frameworks you deferred** — now evaluate them properly, with the criteria from day 15.

Keep the journal going. The habit of writing down what you decided and why is the thing that compounds.

---

**Apprenticeship complete.** Read [SUCCESS_CRITERIA.md](../../SUCCESS_CRITERIA.md) once more and score yourself honestly.
