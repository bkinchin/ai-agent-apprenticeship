# Week 2 — Enterprise Agent

**Outcome:** you can ship a realistic vertical agent, and honestly assess whether it is fit to launch.

| Day | Topic | Key deliverable |
|---|---|---|
| [8](day-08.md) | Product requirements and JTBD | PRD with a v1 line and anti-requirements |
| [9](day-09.md) | Knowledge systems | Cited answers; measured retrieval comparison |
| [10](day-10.md) | Business tools | Idempotent writes; race and ambiguous-write tests pass |
| [11](day-11.md) | Memory | Scoped memory with leakage test and value measurement |
| [12](day-12.md) | Human escalation | Handoff packages; assisted mode |
| [13](day-13.md) | Observability | Full traces; leading-indicator alerts; cost per resolution |
| [14](day-14.md) | Production review | Nine-dimension review; failure analysis; go/no-go |

All of week 2 builds [project 3](../../projects/03-golf-club-agent/).

## The through-line

Week 1 was about the agent. Week 2 is about everything around it — and the discovery that **the hard problems are integration, data quality, and knowing when you're wrong**, not the model.

Day 10 in particular is ordinary distributed-systems engineering. That is the point: most of what makes an enterprise agent reliable has nothing to do with AI.

## Week 2 gate

Before starting week 3:

- [ ] Project 3 conversing across all three capability areas
- [ ] Concurrency and ambiguous-write tests passing
- [ ] Any conversation reconstructable from traces alone
- [ ] Production review complete, with an honest go/no-go
- [ ] Self-assessment updated
