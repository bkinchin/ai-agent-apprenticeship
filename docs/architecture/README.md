# Architecture notes

Decision records. Use [`templates/ARCHITECTURE_TEMPLATE.md`](../../templates/ARCHITECTURE_TEMPLATE.md) for full system documents; short notes can be freeform.

## Expected notes

| File | Day | Records |
|---|---|---|
| `what-is-an-agent.md` | 1 | Your definition, the ladder, where the boundary sits |
| `tool-design.md` | 3 | Your tool principles, with a before/after example |
| `workflow-vs-autonomy.md` | 5 | Where you drew the line between code and model |
| `evaluation-strategy.md` | 7 | The pyramid, your golden set design, judge calibration |
| `knowledge-retrieval.md` | 9 | What you measured, and your trigger for moving to embeddings |
| `tool-reliability.md` | 10 | Idempotency scheme, race handling, compensation |
| `memory-design.md` | 11 | What is remembered, why it isn't a lookup, TTLs, exclusions |
| `observability.md` | 13 | Trace schema, leading indicators, cost attribution |
| `agent-patterns.md` | 15 | Pattern comparison with your own measurements |
| `framework-evaluation.md` | 15 | One framework, tried, with a recommendation |
| `improvement-loop.md` | 19 | The layer table with your own worked examples |

## The framework rule

Before adopting any framework, a note here must state: what it replaces, what it costs, what it locks in, and what measured problem it solves. See [CLAUDE.md](../../CLAUDE.md).
