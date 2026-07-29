# Week 3 — Agent Platform

**Outcome:** you can build a system that produces agents, and explain the whole thing to a senior audience.

| Day | Topic | Key deliverable |
|---|---|---|
| [15](day-15.md) | Architecture patterns | Router, reflection, and multi-agent — all measured |
| [16](day-16.md) | Multi-step planning | Persisted, validated, resumable plans with approval |
| [17](day-17.md) | Agent generation | Spec schema + generation pipeline + a second business |
| [18](day-18.md) | Agent evaluation engine | Agent-agnostic engine; generated golden sets |
| [19](day-19.md) | Agent improvement loop | Layer diagnosis; five verified fixes |
| [20](day-20.md) | Production deployment | Deployed, controlled, governed, cost-modelled |
| [21](day-21.md) | Demo and interview prep | 10-minute demo; 21 answers; case study |

Week 3 builds [project 4](../../projects/04-agent-factory/), on a platform extracted from project 3.

## The through-line

Week 3 is where the two agents you built stop being projects and start being evidence of a pattern. Day 17's extraction — moving the runtime into `shared/` and proving project 3 still passes its evals on it — is the hinge of the whole programme.

The strongest habit to carry out of this week is **layer diagnosis** (day 19): when something is wrong, the prompt is almost never the right place to fix it.

## Completion gate

- [ ] A fifth, unplanned business agent generated from a spec
- [ ] Evaluation engine running across multiple agents
- [ ] An agent deployed with tested kill switch and rollback
- [ ] Demo rehearsed and recorded
- [ ] All 21 interview questions answered in writing
- [ ] Final self-assessment: 4+ on every row of `SUCCESS_CRITERIA.md`
