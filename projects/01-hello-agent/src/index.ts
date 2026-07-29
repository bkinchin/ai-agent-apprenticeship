// Hello Agent — day 1.
// A chat loop. ~50 lines. Read it top to bottom; nothing here is clever.

import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const MODEL = "claude-opus-5";

const FORGET = process.argv.includes("--forget");
const VERBOSE = process.argv.includes("--verbose");

const SYSTEM = "You are a helpful assistant. Keep your replies to two sentences.";

// THE IMPORTANT VARIABLE. Every message, both sides, this session.
// The model has no memory of its own — this array is the memory.
const history: Anthropic.MessageParam[] = [];

let totalCost = 0;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("close", () => process.exit(0)); // ctrl-D / end of input

console.log(`${MODEL}${FORGET ? "  [--forget]" : ""}${VERBOSE ? "  [--verbose]" : ""}`);
console.log("type /exit to quit\n");

while (true) {
  const input = (await rl.question("you › ")).trim();
  if (!input) continue;
  if (input === "/exit") break;

  history.push({ role: "user", content: input });

  // What we send. Normally the whole conversation; with --forget, only the
  // latest message — which is what the model would see if we kept no history.
  const messages = FORGET ? history.slice(-1) : history;

  if (VERBOSE) {
    console.log("\n┌─ sending ────────────────────");
    console.log("system:", SYSTEM);
    console.dir(messages, { depth: null });
    console.log("└──────────────────────────────\n");
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" }, // on by default; not needed today
    system: SYSTEM, // note: a separate field, NOT a message
    messages,
  });

  // response.content is an array of typed blocks, not a string.
  // Today it holds only text. On day 3 it will also hold tool calls.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  history.push({ role: "assistant", content: text });

  const { input_tokens, output_tokens } = response.usage;
  const cost = (input_tokens / 1e6) * 5 + (output_tokens / 1e6) * 25;
  totalCost += cost;

  console.log(`\nclaude › ${text}`);
  console.log(`          in ${input_tokens} · out ${output_tokens} · $${totalCost.toFixed(5)} so far\n`);
}

rl.close();
