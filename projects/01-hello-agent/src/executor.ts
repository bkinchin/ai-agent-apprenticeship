// The only way to run a tool.
//
// The raw implementations are NOT exported. There is no code path from
// outside this file to a tool that skipped the gate — not because anyone
// remembered to be careful, but because the unguarded function isn't
// reachable.

import { z } from "zod";
import { evaluate, type Policy, type PolicyContext, type Tier } from "./policy.js";
import type { TaskState } from "./workflow.js";

export interface World {
  customers: { id: string; email: string; name: string; dob: string }[];
  subscriptions: { customerId: string; plan: string; priceGbp: number; status: string }[];
}

export interface ToolContext {
  policy: Policy;
  state: TaskState;
  world: World;
}

export interface AuditEntry {
  at: string;
  tool: string;
  args: unknown;
  decision: "allowed" | "denied" | "invalid_args" | "unknown_tool";
  ruleId?: string;
  tier?: Tier;
  policyVersions?: Record<Tier, number>;
  result?: string;
}

export const TOOL_SPECS = [
  {
    name: "find_customer",
    description: "Look up a customer by email address. Returns their ID and name.",
    schema: z.object({ email: z.email().describe("The customer's email address") }),
  },
  {
    name: "verify_customer",
    description:
      "Verify identity by checking a date of birth against our records. " +
      "Required before any account details can be discussed.",
    schema: z.object({
      customerId: z.string().regex(/^CUST-\d{4}$/),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD"),
    }),
  },
  {
    name: "get_subscription",
    description: "Get the customer's subscription: plan, price and status.",
    schema: z.object({ customerId: z.string().regex(/^CUST-\d{4}$/) }),
  },
  {
    name: "offer_retention",
    description: "Present the available retention offer to the customer.",
    schema: z.object({ customerId: z.string().regex(/^CUST-\d{4}$/) }),
  },
  {
    name: "cancel_subscription",
    description: "Cancel the subscription. Irreversible.",
    schema: z.object({ customerId: z.string().regex(/^CUST-\d{4}$/) }),
  },
] as const;

// ── Private. Nothing outside this file can reach these. ───────────
const IMPLEMENTATIONS: Record<string, (args: any, ctx: ToolContext) => string> = {
  find_customer: ({ email }, { world }) => {
    const c = world.customers.find((x) => x.email === email);
    return c ? JSON.stringify({ id: c.id, name: c.name }) : `No customer with email ${email}.`;
  },

  verify_customer: ({ customerId, dateOfBirth }, { world, state }) => {
    const c = world.customers.find((x) => x.id === customerId);
    const matches = c !== undefined && c.dob === dateOfBirth;
    if (matches) state.verifiedCustomerId = customerId; // evidence, written by code
    return matches
      ? "Identity confirmed."
      : "Those details do not match. Do not disclose any account information.";
  },

  get_subscription: ({ customerId }, { world, state }) => {
    const s = world.subscriptions.find((x) => x.customerId === customerId);
    if (!s) return `No subscription for ${customerId}.`;
    state.subscriptionInspected = true;
    return JSON.stringify(s);
  },

  offer_retention: ({ customerId }, { world, state }) => {
    const s = world.subscriptions.find((x) => x.customerId === customerId);
    if (!s) return `No subscription for ${customerId}.`;
    state.retentionOffered = true; // evidence the commercial rule needs
    return JSON.stringify({ offer: "50% off for 3 months", newPriceGbp: s.priceGbp / 2 });
  },

  cancel_subscription: ({ customerId }, { world, state }) => {
    const s = world.subscriptions.find((x) => x.customerId === customerId);
    if (!s) return `No subscription for ${customerId}.`;
    s.status = "cancelled";
    state.executedAction = { tool: "cancel_subscription", customerId };
    return JSON.stringify({ customerId, status: "cancelled" });
  },
};

export const auditLog: AuditEntry[] = [];

function record(e: Omit<AuditEntry, "at">): void {
  auditLog.push({ at: new Date().toISOString(), ...e });
}

/** THE ONLY EXPORTED WAY TO RUN A TOOL. */
export function runTool(name: string, input: unknown, ctx: ToolContext): string {
  // 1. Does it exist?
  const spec = TOOL_SPECS.find((t) => t.name === name);
  const impl = IMPLEMENTATIONS[name];
  if (!spec || !impl) {
    record({ tool: name, args: input, decision: "unknown_tool" });
    return `Unknown tool: ${name}`;
  }

  // 2. Are the arguments the right shape?  (day 4)
  const parsed = spec.schema.safeParse(input);
  if (!parsed.success) {
    record({ tool: name, args: input, decision: "invalid_args" });
    return `Invalid arguments for ${name}: ${parsed.error.issues[0]!.message}`;
  }

  // 3. Does policy permit it?  (day 6) — NOT SKIPPABLE
  const policyCtx: PolicyContext = {
    verified: ctx.state.verifiedCustomerId !== undefined,
    flags: { retentionOffered: ctx.state.retentionOffered === true },
  };
  const decision = evaluate(ctx.policy, name, policyCtx);

  if (!decision.allow) {
    record({
      tool: name,
      args: parsed.data,
      decision: "denied",
      ruleId: decision.ruleId,
      tier: decision.tier,
      policyVersions: decision.versions,
    });
    // A denial is a conversation, not an error. The model reads this and
    // explains it to the customer.
    return `Not permitted: ${decision.message}`;
  }

  // 4. Run it.
  const result = impl(parsed.data, ctx);

  // 5. Record what actually happened.
  record({
    tool: name,
    args: parsed.data,
    decision: "allowed",
    policyVersions: decision.versions,
    result,
  });

  return result;
}
