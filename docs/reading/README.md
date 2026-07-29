# Reading

Curated sources with **your own notes**. A link without a note is worthless — the note is the artefact.

## Format

```markdown
## [Title](url)
**Source:** · **Read:** · **Relevance:** high/medium/low

**Claim:** what it argues, in one sentence.

**Useful:** what you took from it.

**Disagree:** where your own experience contradicts it.

**Applies to:** which day / project.
```

The **Disagree** section is the valuable one. By week 2 you will have measured things that contradict published advice — record that, because it is what you will draw on in interviews.

## Where to look

**Primary sources** — model provider documentation on tool use, structured outputs, and prompt caching. Read the actual API docs, not summaries of them.

**Engineering blogs from teams operating agents in production** — the ones that publish incident write-ups and evaluation methodology are worth more than the ones publishing architecture diagrams.

**Adjacent disciplines that agent engineering keeps rediscovering:**
- Distributed systems — idempotency, compensation, partial failure (day 10 is mostly this)
- Site reliability engineering — leading indicators, runbooks, error budgets (day 13, 20)
- Safety-critical systems — fail-closed design, defence in depth (day 6)
- Information retrieval — the pre-LLM literature on ranking and evaluation (day 9)

**Be sceptical of:** anything claiming a framework solves reliability; benchmark results without a described golden set; multi-agent architectures presented without cost and latency numbers.

## Suggested reading by week

| Week | Focus |
|---|---|
| 1 | Provider API docs — tool calling, structured outputs. Read them properly, once. |
| 2 | Retrieval evaluation; distributed systems failure patterns |
| 3 | Agent architecture patterns; evaluation methodology; AI governance and regulation relevant to your market |
