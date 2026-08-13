// The agent loop. Two tools, where the second needs the first's answer.
// Run: npx tsx --env-file=../../.env.local src/loop-demo.ts

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENT_MODEL } from "../core/models.js";

const client = new Anthropic();
const MODEL = AGENT_MODEL; // was hardcoded — see core/models.ts
const MAX_STEPS = 8; // hard ceiling. See note at the bottom of the loop.

// ── Fake data ────────────────────────────────────────────────────
const CUSTOMERS = [
  { id: "CUST-1029", email: "billy@example.com", name: "Billy Kinchin" },
  { id: "CUST-2044", email: "sam@example.com", name: "Sam Okafor" },
];

const SUBSCRIPTIONS = [
  { customerId: "CUST-1029", plan: "PRO", priceGbp: 49, renewsOn: "2026-08-14", status: "active" },
  { customerId: "CUST-2044", plan: "BASIC", priceGbp: 12, renewsOn: "2026-09-01", status: "active" },
];

// ── ONE definition per tool ──────────────────────────────────────
// The Zod schema is the single source of truth. Everything else is
// derived from it, so the two can never drift apart.
const TOOL_SPECS = [
  {
    name: "find_customer",
    description:
      "Look up a customer by their email address. Returns their customer ID " +
      "and name. Use this first — other tools need the customer ID.",
    schema: z.object({
      email: z.email().describe("The customer's email address"),
    }),
  },
  {
    name: "get_subscription",
    description:
      "Retrieve a customer's current subscription: plan, price, renewal date " +
      "and status. Requires a customer ID from find_customer.",
    schema: z.object({
      customerId: z.string().regex(/^CUST-\d{4}$/).describe("e.g. CUST-1029"),
    }),
  },
] as const;

// Derived #1 — what gets SENT TO THE MODEL.
const tools: Anthropic.Tool[] = TOOL_SPECS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: z.toJSONSchema(t.schema) as Anthropic.Tool["input_schema"],
}));

// Derived #2 — what YOUR CODE checks against.
const SCHEMAS: Record<string, z.ZodType> = Object.fromEntries(
  TOOL_SPECS.map((t) => [t.name, t.schema]),
);

// ── What actually runs. Ours, always. ────────────────────────────
function execute(name: string, input: unknown): string {
  const schema = SCHEMAS[name];
  if (!schema) return `Unknown tool: ${name}`;

  // THE GATE. Nothing below this line runs on unchecked data.
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return `Invalid arguments for ${name}: ${problems}`;
  }

  switch (name) {
    case "find_customer": {
      // Still a cast — but now it's backed by a check that just passed.
      const { email } = parsed.data as { email: string };
      const found = CUSTOMERS.find((c) => c.email === email);
      return found
        ? JSON.stringify(found)
        : `No customer found with email ${email}. Ask them to confirm the address.`;
    }
    case "get_subscription": {
      const { customerId } = parsed.data as { customerId: string };
      const found = SUBSCRIPTIONS.find((s) => s.customerId === customerId);
      return found
        ? JSON.stringify(found)
        : `No subscription found for ${customerId}. They may never have subscribed.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── The loop ─────────────────────────────────────────────────────
const messages: Anthropic.MessageParam[] = [
  // Note: "billy" is not an email address. Watch what the schema does.
  { role: "user", content: "hi, my email is billy@example — what am I paying each month?" },
];

let steps = 0;

while (steps < MAX_STEPS) {
  steps++;
  console.log(`\n─── step ${steps} ─────────────────────────────`);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools,
    messages,
  });

  // The assistant's turn goes back verbatim, whatever it contains.
  messages.push({ role: "assistant", content: response.content });

  const toolUses = response.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );

  // No tools requested → the model is finished.
  if (toolUses.length === 0) {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    console.log(`DONE after ${steps} steps.\n\n${text}\n`);
    process.exit(0);
  }

  // One response can ask for SEVERAL tools. Run them all, and send every
  // result back in a SINGLE user message — one result per request.
  const results: Anthropic.ToolResultBlockParam[] = [];

  for (const use of toolUses) {
    console.log(`  → ${use.name}(${JSON.stringify(use.input)})`);
    const result = execute(use.name, use.input);
    console.log(`  ← ${result}`);
    results.push({ type: "tool_result", tool_use_id: use.id, content: result });
  }

  messages.push({ role: "user", content: results });
}

// Falling out of the loop is not "finished" — it's a failure that needs
// looking at. Something made the model go round in circles.
console.error(`\nStopped: hit MAX_STEPS (${MAX_STEPS}) without an answer.`);
process.exit(1);
