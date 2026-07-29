# shared/prompts

Versioned prompt fragments and assembly helpers.

## Principles

- **Prompts are code.** Version them, review them, changelog them.
- **Stamp the version into every trace** (day 13). "It got worse last week" is only answerable if you can diff.
- **Compose, don't duplicate.** A prompt is: identity + capabilities + constraints + stage context + tone. Each is a fragment.
- **Prompts are guidance, not enforcement.** Anything that matters belongs in [`../policies/`](../policies/).

## Layout

```
prompts/
├── fragments/          # composable pieces
│   ├── identity.md
│   ├── constraints.md
│   └── tone/
├── stages/             # per-stage prompt fragments (day 5)
├── judges/             # evaluation rubrics (day 7) — kept separate on purpose
└── CHANGELOG.md        # version, change, evidence
```

## Changelog format

Every entry carries evidence:

```
## v1.6.0 — 2026-07-22
- Added explicit fee-tool requirement (see policy no-unverified-prices)
  Fixes: fees-2026-07-19 cluster (14 escalations/week)
  Eval:  task_success 0.94 → 0.96 · cost unchanged · 0 regressions
```

A prompt change without eval evidence is a guess. See [day 19](../../curriculum/week-03/day-19.md).

> **Populated from:** days 1, 5, 7, 19
