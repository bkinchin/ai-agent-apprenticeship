// Turning a finished conversation into a row you could put in a database.
// Run: npx tsx --env-file=../../.env.local src/outcome-demo.ts

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { AGENT_MODEL } from "../core/models.js";

const client = new Anthropic();
const MODEL = AGENT_MODEL; // was hardcoded — see core/models.ts

// A DISCRIMINATED UNION: two possible shapes. The "outcome" field
// decides which one you're looking at, so the agent has an in-band,
// type-safe way to say "I couldn't do this".
const ConversationOutcome = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("resolved"),
    action: z.enum(["cancelled", "retained", "information_only"]),
    reason: z.enum([
      "too_expensive",
      "not_using",
      "missing_features",
      "switching_competitor",
      "other",
    ]),
    summary: z.string().max(160),
  }),
  z.object({
    outcome: z.literal("needs_human"),
    reason: z.enum(["policy", "customer_request", "emotional", "out_of_scope"]),
    urgency: z.enum(["standard", "high"]),
    summary: z.string().max(160),
  }),
]);

const TRANSCRIPTS: Record<string, string> = {
  "straightforward cancellation": `
    customer: I want to cancel, it's too expensive for how little I use it.
    agent:    I can do that. Would a 30% discount for 3 months help?
    customer: No thanks, just cancel it.
    agent:    Done — cancelled, effective at the end of your billing period.`,

  "retention offer accepted": `
    customer: I'm thinking of cancelling, £49 is a lot right now.
    agent:    I understand. I can offer 50% off for the next three months.
    customer: Actually yes, that would really help. Let's do that.
    agent:    Applied. Your next three invoices will be £24.50.`,

  "angry, wants a manager": `
    customer: This is the third time I've been charged after cancelling.
    agent:    I'm sorry — let me look into that.
    customer: No. I want a manager, now. I'm done explaining this.`,
};

for (const [label, transcript] of Object.entries(TRANSCRIPTS)) {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    system: "You summarise finished support conversations into structured records.",
    messages: [{ role: "user", content: `Summarise this conversation:\n${transcript}` }],
    output_config: { format: zodOutputFormat(ConversationOutcome) },
  });

  console.log(`\n═══ ${label} ═══`);
  console.log(response.parsed_output);
}
console.log("");
