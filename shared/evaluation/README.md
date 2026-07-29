# shared/evaluation

The evaluation engine. Agent-agnostic, data-driven, comparable across agents and over time.

## The agent contract

```ts
interface EvaluableAgent {
  id: string;
  version: string;
  reset(fixtures: Fixtures): Promise<void>;
  send(message: string): Promise<AgentTurn>;
  getTrace(): Trace;
  getState(): TaskState;
  getSideEffects(): SideEffect[];   // the most important one
}
```

`getSideEffects()` is what makes objective evaluation possible. Text quality is subjective; what changed in the world is not.

## Checker families

| Family | Deterministic | Blocks release |
|---|---|---|
| Side effects | yes | on critical cases |
| Trajectory (tools, order, stages) | yes | on critical cases |
| Policy violations | yes | **always** |
| Schema validity | yes | yes |
| Response quality (LLM judge) | no | no — threshold only |
| Cost / latency | yes | warn |

**Critical failures block the build. Quality scores trend.** Blocking on quality makes people disable the eval; blocking on safety makes them fix the agent.

## Golden set

| Category | Share |
|---|---|
| Happy paths | 20% |
| Realistic variation | 30% |
| Edge cases | 25% |
| Adversarial | 15% |
| Regressions | 10% |

Rules: 20% holdout never used for tuning · refreshed monthly from production · **every production bug becomes a permanent case**.

## Judges

One dimension per judge. 3-point scale. Anchored rubric. Required citation. **Calibrated against ≥ 15 human-scored cases, agreement ≥ 80%.** An uncalibrated judge is a random number generator with good manners.

## Tiers

| Tier | When | Budget |
|---|---|---|
| Smoke (critical only) | every commit | < 2 min |
| Standard | every PR | < 15 min |
| Full (× 3 runs) | nightly | ~1 hr |
| Adversarial | weekly + pre-release | — |

Report flakiness rather than averaging it away. Critical cases are reported at their **worst** result across runs.

> **Populated from:** days 7, 18
