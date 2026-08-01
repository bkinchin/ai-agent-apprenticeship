// The agent loop. Two tools, where the second needs the first's answer.
// Run: npx tsx --env-file=../../.env.local src/loop-demo.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-opus-5";
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

// ── What the model is told exists ────────────────────────────────
const tools: Anthropic.Tool[] = [
  {
    name: "find_customer",
    description:
      "Look up a customer by their email address. Returns their customer ID " +
      "and name. Use this first — other tools need the customer ID.",
    input_schema: {
      type: "object",
      properties: { email: { type: "string", description: "The customer's email address" } },
      required: ["email"],
    },
  },
  {
    name: "get_subscription",
    description:
      "Retrieve a customer's current subscription: plan, price, renewal date " +
      "and status. Requires a customer ID from find_customer.",
    input_schema: {
      type: "object",
      properties: { customerId: { type: "string", description: "e.g. CUST-1029" } },
      required: ["customerId"],
    },
  },
];

// ── What actually runs. Ours, always. ────────────────────────────
function execute(name: string, input: unknown): string {
  switch (name) {
    case "find_customer": {
      const { email } = input as { email: string };
      const found = CUSTOMERS.find((c) => c.email === email);
      return found
        ? JSON.stringify(found)
        : `No customer found with email ${email}. Ask them to confirm the address.`;
    }
    case "get_subscription": {
      const { customerId } = input as { customerId: string };
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
  { role: "user", content: "I'm billy@example.com — what am I paying each month?" },
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
