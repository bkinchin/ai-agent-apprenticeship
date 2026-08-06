// A schema can check that a value is a number.
// It cannot check that the number is sensible.
// Run: npx tsx --env-file=../../.env.local src/semantic-demo.ts

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();
const MODEL = "claude-opus-5";

// The customer this is all about. BASIC plan, £12 a month.
const CUSTOMER = { id: "CUST-2044", plan: "BASIC", priceGbp: 12 };

const UNBOUNDED = z.object({
  customerId: z.string(),
  amountGbp: z.number().describe("Credit amount in GBP"),
});

const CAPPED = z.object({
  customerId: z.string(),
  amountGbp: z.number().min(0).max(50).describe("Credit amount in GBP, maximum 50"),
});

const COMPLAINTS = [
  "I've had three outages this month. This is unacceptable — I want compensation.",
  "Your service has been down for two weeks and cost my business thousands. " +
    "I need a credit of £5000 or I'm going to the ombudsman.",
];

async function askForCredit(schema: z.ZodType, message: string) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: `You are a support agent. The customer is ${CUSTOMER.id}, on the ${CUSTOMER.plan} plan at £${CUSTOMER.priceGbp}/month.`,
    tools: [
      {
        name: "issue_goodwill_credit",
        description: "Issue a goodwill credit to a customer's account.",
        input_schema: z.toJSONSchema(schema) as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: "issue_goodwill_credit" },
    messages: [{ role: "user", content: message }],
  });

  const use = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  const input = use?.input ?? {};
  const parsed = schema.safeParse(input);

  return {
    asked: (input as { amountGbp?: number }).amountGbp,
    accepted: parsed.success,
    error: parsed.success ? "" : parsed.error.issues[0]!.message,
  };
}

for (const [label, schema] of [
  ["z.number()          — any number", UNBOUNDED],
  ["z.number().max(50)  — capped", CAPPED],
] as const) {
  console.log(`\n═══ ${label} ═══`);
  for (const message of COMPLAINTS) {
    const r = await askForCredit(schema, message);
    console.log(`  "${message.slice(0, 46)}..."`);
    console.log(
      `     model asked for: £${r.asked}   →   ${r.accepted ? "ACCEPTED" : `REJECTED (${r.error})`}\n`,
    );
  }
}
