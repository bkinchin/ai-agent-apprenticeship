import Anthropic from "@anthropic-ai/sdk";

// Reads ANTHROPIC_API_KEY from the environment. Never pass a key literal.
const client = new Anthropic();

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-5";

// USD per million tokens. Pinned here so cost is visible in the code
// rather than discovered on a bill.
const PRICE_IN = 5.0;
const PRICE_OUT = 25.0;

export interface Reply {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/**
 * One call to the model. This is the ONLY place in the project that talks to
 * the API — everything else deals in plain data.
 *
 * That constraint is the point. On day 2 you swap what goes into `messages`.
 * On day 3 you add tools. Neither should require touching this file's callers.
 */
export async function callModel(
  system: string,
  messages: Anthropic.MessageParam[],
): Promise<Reply> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,

    // Extended thinking is ON by default on Opus 5. Disabled for day 1:
    // it costs tokens and latency you aren't using yet. Note that max_tokens
    // caps thinking AND response text *together* — leaving thinking on with a
    // small max_tokens is how you get truncated mid-sentence and blame the model.
    thinking: { type: "disabled" },

    // `system` is a top-level parameter, NOT a message with role "system".
    // Instructions and conversation are structurally separate. Day 2 is built
    // on this seam.
    system,
    messages,
  });

  // response.content is an ARRAY OF TYPED BLOCKS, not a string.
  // Today it only ever holds `text` blocks. On day 3 it will also hold
  // `tool_use` blocks — narrowing on .type now is what makes that a small change.
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  const { input_tokens, output_tokens } = response.usage;

  return {
    text,
    inputTokens: input_tokens,
    outputTokens: output_tokens,
    costUsd:
      (input_tokens / 1_000_000) * PRICE_IN +
      (output_tokens / 1_000_000) * PRICE_OUT,
  };
}
