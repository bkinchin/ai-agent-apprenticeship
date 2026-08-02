// The same loop as loop-demo.ts, plus ONE tool that changes the world.
// Deliberately unprotected. The point is to see what that costs.
//
// Run: npx tsx --env-file=../../.env.local src/write-demo.ts "your message"

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-opus-5";
const MAX_STEPS = 8;

const CUSTOMERS = [
  { id: "CUST-1029", email: "billy@example.com", name: "Billy Kinchin" },
  { id: "CUST-2044", email: "sam@example.com", name: "Sam Okafor" },
];

// This one gets mutated by cancel_subscription. Note `const` does NOT
// prevent that — it only stops the variable being pointed at a different
// array. The objects inside are freely writable.
const SUBSCRIPTIONS = [
  { customerId: "CUST-1029", plan: "PRO", priceGbp: 49, renewsOn: "2026-08-14", status: "active" },
  { customerId: "CUST-2044", plan: "BASIC", priceGbp: 12, renewsOn: "2026-09-01", status: "active" },
];

const tools: Anthropic.Tool[] = [
  {
    name: "find_customer",
    description:
      "Look up a customer by their email address. Returns their customer ID and name.",
    input_schema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"],
    },
  },
  {
    name: "get_subscription",
    description:
      "Retrieve a customer's current subscription: plan, price, renewal date and status.",
    input_schema: {
      type: "object",
      properties: { customerId: { type: "string" } },
      required: ["customerId"],
    },
  },
  {
    // ⚠️  THE WRITE TOOL. No confirmation. No verification. No audit.
    name: "cancel_subscription",
    description: "Cancel a customer's subscription. This takes effect immediately.",
    input_schema: {
      type: "object",
      properties: { customerId: { type: "string" } },
      required: ["customerId"],
    },
  },
];

/** Every tool call that actually ran, so we can see the damage afterwards. */
const auditLog: string[] = [];

function execute(name: string, input: unknown): string {
  switch (name) {
    case "find_customer": {
      const { email } = input as { email: string };
      const found = CUSTOMERS.find((c) => c.email === email);
      return found ? JSON.stringify(found) : `No customer found with email ${email}.`;
    }
    case "get_subscription": {
      const { customerId } = input as { customerId: string };
      const found = SUBSCRIPTIONS.find((s) => s.customerId === customerId);
      return found ? JSON.stringify(found) : `No subscription found for ${customerId}.`;
    }
    case "cancel_subscription": {
      const { customerId } = input as { customerId: string };
      const sub = SUBSCRIPTIONS.find((s) => s.customerId === customerId);
      if (!sub) return `No subscription found for ${customerId}.`;

      sub.status = "cancelled"; // ← the world changes here
      auditLog.push(`CANCELLED ${customerId} (${sub.plan}, £${sub.priceGbp}/mo)`);
      return JSON.stringify({ customerId, status: "cancelled" });
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

const userMessage = process.argv[2] ?? "I want to cancel my subscription. I'm billy@example.com";

console.log(`\nUSER: ${userMessage}`);
console.log(`BEFORE: ${SUBSCRIPTIONS.map((s) => `${s.customerId}=${s.status}`).join("  ")}\n`);

const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
let steps = 0;

while (steps < MAX_STEPS) {
  steps++;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools,
    messages,
  });

  messages.push({ role: "assistant", content: response.content });

  const toolUses = response.content.filter(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );

  if (toolUses.length === 0) {
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    console.log(`\nAGENT: ${text}\n`);
    break;
  }

  const results: Anthropic.ToolResultBlockParam[] = [];
  for (const use of toolUses) {
    const isWrite = use.name === "cancel_subscription";
    console.log(`  ${isWrite ? "⚠️ " : "  "}${use.name}(${JSON.stringify(use.input)})`);
    results.push({
      type: "tool_result",
      tool_use_id: use.id,
      content: execute(use.name, use.input),
    });
  }
  messages.push({ role: "user", content: results });
}

console.log(`AFTER : ${SUBSCRIPTIONS.map((s) => `${s.customerId}=${s.status}`).join("  ")}`);
console.log(`AUDIT : ${auditLog.length ? auditLog.join(" | ") : "(nothing was changed)"}\n`);
