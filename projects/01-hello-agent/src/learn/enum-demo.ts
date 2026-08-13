// Free text vs enum, for the same field, on the same three customers.
// Run: npx tsx --env-file=../../.env.local src/enum-demo.ts

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENT_MODEL } from "../core/models.js";

const client = new Anthropic();
const MODEL = AGENT_MODEL; // was hardcoded — see core/models.ts

// Two versions of the SAME field.
const FREE_TEXT = z.object({
  reason: z.string().describe("Why the customer is cancelling"),
});

const ENUM = z.object({
  reason: z
    .enum(["too_expensive", "not_using", "missing_features", "switching_competitor", "other"])
    .describe("Why the customer is cancelling"),
});

const CUSTOMERS_SAYING = [
  "cancel my subscription, it's way too expensive for what I actually get",
  "please cancel my account — I've barely logged in for months now",
  "cancelling, I'm moving to a competitor that supports SSO",
];

async function askForReason(schema: z.ZodType, message: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools: [
      {
        name: "cancel_subscription",
        description: "Cancel the customer's subscription.",
        input_schema: z.toJSONSchema(schema) as Anthropic.Tool["input_schema"],
      },
    ],
    tool_choice: { type: "tool", name: "cancel_subscription" }, // force the call
    messages: [{ role: "user", content: message }],
  });

  const use = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  return (use?.input as { reason?: string })?.reason ?? "(none)";
}

for (const [label, schema] of [
  ["FREE TEXT  z.string()", FREE_TEXT],
  ["ENUM       z.enum([...])", ENUM],
] as const) {
  console.log(`\n═══ ${label} ═══`);
  for (const message of CUSTOMERS_SAYING) {
    const reason = await askForReason(schema, message);
    console.log(`  "${message.slice(0, 42)}..."`);
    console.log(`     → ${reason}\n`);
  }
}
