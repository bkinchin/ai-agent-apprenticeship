// The policy engine.
//
// Two files, two owners, two change processes:
//
//   safety-baseline.yaml   harm prevention. Not editable by automation.
//   commercial.yaml        business rules. Editable with approval.
//
// Safety is always evaluated FIRST, so nothing in commercial.yaml can
// permit what the baseline denies. That is a property of the ordering,
// not of anyone remembering to be careful.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";

const Rule = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("require_verified"),
    tools: z.array(z.string()).min(1),
    rationale: z.string(),
    message: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("require_flag"),
    flag: z.string(),
    tools: z.array(z.string()).min(1),
    rationale: z.string(),
    message: z.string(),
  }),
]);

const PolicyFile = z.object({
  version: z.number().int().positive(),
  updated: z.string(),
  owner: z.string(),
  editable_by: z.array(z.string()).min(1),
  rules: z.array(Rule).min(1),
});

export type Tier = "safety" | "commercial";
export type LoadedRule = z.infer<typeof Rule> & { tier: Tier; owner: string };

export interface Policy {
  rules: LoadedRule[]; // safety first, always
  versions: Record<Tier, number>;
}

function readFile(path: string, tier: Tier): { rules: LoadedRule[]; version: number } {
  const parsed = PolicyFile.safeParse(parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    // Fail at startup, loudly. A typo'd rule that silently does nothing
    // is a DISABLED CONTROL — worse than no rule, because you think you
    // have one.
    throw new Error(
      `Invalid policy at ${path}:\n` +
        parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n"),
    );
  }
  const { version, owner, rules } = parsed.data;
  return { version, rules: rules.map((r) => ({ ...r, tier, owner })) };
}

export function loadPolicy(dir = "../../shared/policies"): Policy {
  const safety = readFile(`${dir}/safety-baseline.yaml`, "safety");
  const commercial = readFile(`${dir}/commercial.yaml`, "commercial");

  // A commercial rule must never reuse a safety rule's id — that would
  // make it look like the baseline had been edited.
  const safetyIds = new Set(safety.rules.map((r) => r.id));
  for (const r of commercial.rules) {
    if (safetyIds.has(r.id)) {
      throw new Error(`commercial.yaml reuses safety rule id "${r.id}"`);
    }
  }

  return {
    rules: [...safety.rules, ...commercial.rules], // ★ order is the guarantee
    versions: { safety: safety.version, commercial: commercial.version },
  };
}

// ── Evaluation ───────────────────────────────────────────────────

export interface PolicyContext {
  verified: boolean;
  flags: Record<string, boolean>;
}

export type PolicyDecision =
  | { allow: true; versions: Record<Tier, number> }
  | {
      allow: false;
      ruleId: string;
      tier: Tier;
      message: string;
      versions: Record<Tier, number>;
    };

export function evaluate(policy: Policy, tool: string, ctx: PolicyContext): PolicyDecision {
  for (const rule of policy.rules) {
    if (!rule.tools.includes(tool)) continue;

    const satisfied =
      rule.type === "require_verified" ? ctx.verified : ctx.flags[rule.flag] === true;

    if (!satisfied) {
      return {
        allow: false,
        ruleId: rule.id,
        tier: rule.tier,
        message: rule.message.trim(),
        versions: policy.versions,
      };
    }
  }
  return { allow: true, versions: policy.versions };
}

/** Every rule in force, in evaluation order. The answer to "what are the rules?" */
export function listRules(policy: Policy): string {
  return policy.rules
    .map(
      (r) =>
        `[${r.tier.padEnd(10)}] ${r.id.padEnd(28)} ${r.tools.join(", ")}\n` +
        `${" ".repeat(13)}owner: ${r.owner}`,
    )
    .join("\n");
}
