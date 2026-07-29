# shared/

Reusable primitives extracted from the projects. This directory eventually becomes the **platform** that the [Agent Factory](../projects/04-agent-factory/) generates configuration for.

## The rule

**Nothing goes in here speculatively.**

A component is promoted to `shared/` only after it has been used **twice** — once in the project that motivated it, once in a project that reused it. Until then it lives in the project that needs it.

This rule exists because premature abstraction is the most common way platform projects fail. You cannot design the right interface for a component you have only used once; you will build for a generality you imagined rather than one you encountered.

| Extraction | When | From |
|---|---|---|
| Evaluation runner | Day 7 | Project 2 → reused by 3 |
| Policy engine | Day 6 → shared day 17 | Project 2 → reused by 3 |
| Escalation, tracing, memory, retrieval | Day 17 | Project 3 |
| Everything else | Day 17 | Project 3 |

Day 17's extraction is validated by a single test: **project 3's evaluation suite must still pass when it runs on the extracted platform.**

## Directories

### [`prompts/`](prompts/)
Versioned prompt fragments and assembly helpers. Prompts are code: versioned, reviewed, changelogged, and stamped into traces.

### [`tools/`](tools/)
The tool abstraction — `Tool` type, registry, executor (validation, policy check, timeout, retry, tracing), and reusable tool patterns like the hold/confirm and orchestrated-with-compensation shapes from day 10.

### [`evaluation/`](evaluation/)
The evaluation engine: `EvaluableAgent` interface, declarative case schema, runner, the five checker families, result store, and regression reporting.

### [`memory/`](memory/)
Subject-scoped memory store with provenance, TTL, contradiction handling, budgeted retrieval, and the show/correct/delete operations.

### [`policies/`](policies/)
Policy schema, engine, and the YAML policy sets themselves. Policies live here rather than in projects because they are reviewed by business owners and reused across agents.

## Design constraints

- **No project-specific knowledge.** If it mentions golf or subscriptions, it does not belong here.
- **Pure functions where possible.** Policy evaluation, transition guards, and checkers must be testable without I/O or an API key.
- **Injectable model client.** Everything must be runnable against a stub.
- **Versioned.** Anything whose change could alter agent behaviour carries a version that is stamped into traces.
