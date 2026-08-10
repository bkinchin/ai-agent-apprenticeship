// Which model runs which job.
//
// One place, so swapping a model is a config change rather than a
// find-and-replace. That is not just tidiness — CLAUDE.md claims "the
// model is a dependency, not the architecture; if swapping the model
// rewrites the system, the system is wrong." Until now nothing in this
// repo could test that claim. Now it can:
//
//   ANTHROPIC_MODEL=claude-haiku-4-5 npm run eval
//
// COST. The agent is ~92% of every conversation (the guards were moved
// to Haiku on day 6 and are 4-8%). Opus 5 is $5/$25 per MTok; Haiku 4.5
// is $1/$5. So iterating on the HARNESS — does the case run, does the
// assertion fire, does the report read correctly — costs a fifth as
// much on Haiku, and none of that work needs the production model.
//
// Use the cheap model to build the eval. Use the real model for any
// number you write down. A baseline measured on a model you would not
// ship is not a baseline.

import { PRICING } from "./cost.js";

const DEFAULT_AGENT = "claude-opus-5";
const DEFAULT_GUARD = "claude-haiku-4-5";

/**
 * An unpriced model silently costs $0.
 *
 * cost.ts falls back to `{ in: 0, out: 0 }` for anything it doesn't
 * recognise, so a typo'd model name would produce a full run reporting
 * "cost per conversation: $0.0000" — which reads as a spectacular
 * saving rather than a broken measurement. Same family of failure as
 * the judge that scored a dead API and the eval that counted a crashed
 * case as a pass: the number is present, plausible, and meaningless.
 */
function checked(model: string, role: string): string {
  if (!(model in PRICING)) {
    console.warn(
      `  ⚠ no pricing for ${role} model "${model}" — cost will report $0.00, ` +
        `which is wrong, not free. Add it to PRICING in cost.ts.`,
    );
  }
  return model;
}

/** The conversation itself. Opus by default; override to iterate cheaply. */
export const AGENT_MODEL = checked(
  process.env.ANTHROPIC_MODEL ?? DEFAULT_AGENT,
  "agent",
);

/**
 * Classifiers and the judge. Deliberately a SEPARATE variable.
 *
 * These answer one narrow question in isolation and were calibrated on
 * Haiku — 16/16 escalation, 16/16 judge. Dragging them along with an
 * agent model change would silently invalidate those measurements.
 */
export const GUARD_MODEL = checked(
  process.env.ANTHROPIC_GUARD_MODEL ?? DEFAULT_GUARD,
  "guard",
);

/**
 * Printed at the top of a run so no report is ambiguous about what
 * produced it.
 *
 * It used to append "← OVERRIDDEN, not a baseline" whenever the agent
 * model differed from the default. That was wrong: it assumed Opus was
 * canonical and anything else was a deviation. Which model this project
 * targets is a DECISION, not a default — and the honest reason to pick
 * a cheap one is that a baseline you can afford to re-run catches more
 * regressions than a precise one you run twice.
 *
 * So it just names the model. Switching is `ANTHROPIC_MODEL=...` or
 * unsetting it; there is nothing in the code to change either way.
 */
export function modelBanner(): string {
  return `agent: ${AGENT_MODEL}   guards: ${GUARD_MODEL}`;
}
