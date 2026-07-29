import readline from "node:readline/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { callModel, MODEL } from "./llm.js";

const FORGET = process.argv.includes("--forget");
const VERBOSE = process.argv.includes("--verbose");

const SYSTEM = "You are a helpful assistant. Keep your replies to two sentences.";

/** Everything the model has said and been told, this session. */
const history: Anthropic.MessageParam[] = [];

let totalCost = 0;
let turn = 0;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log(`model=${MODEL}  forget=${FORGET}  verbose=${VERBOSE}`);
console.log("type /exit to quit\n");

while (true) {
  const input = (await rl.question("you › ")).trim();
  if (!input) continue;
  if (input === "/exit") break;
  turn++;

  // ─────────────────────────────────────────────────────────────────────
  // TODO 1 — Build the request.
  //
  // What does the model actually receive this turn?
  //   • Normally:      everything in `history`, then this turn's user message.
  //   • With --forget: ONLY this turn's user message.
  //
  // A user message looks like: { role: "user", content: input }
  // ─────────────────────────────────────────────────────────────────────
  const messages: Anthropic.MessageParam[] = [];

  // ─────────────────────────────────────────────────────────────────────
  // TODO 2 — If VERBOSE, print SYSTEM and `messages` before the call.
  //
  // Use console.dir(messages, { depth: null }) so nothing is elided.
  // Look at the output properly. That object is the agent's entire world.
  // ─────────────────────────────────────────────────────────────────────

  const reply = await callModel(SYSTEM, messages);

  // ─────────────────────────────────────────────────────────────────────
  // TODO 3 — Record this turn in `history`.
  //
  // Append BOTH sides: the user message AND the assistant's reply
  //   { role: "assistant", content: reply.text }
  //
  // Ask yourself why both. What breaks next turn if you only keep one?
  // ─────────────────────────────────────────────────────────────────────

  totalCost += reply.costUsd;

  console.log(`\nclaude › ${reply.text}\n`);
  console.log(
    `         [turn ${turn} · in ${reply.inputTokens} out ${reply.outputTokens}` +
      ` · $${reply.costUsd.toFixed(5)} · session $${totalCost.toFixed(5)}]\n`,
  );
}

rl.close();
console.log(`\n${turn} turns · $${totalCost.toFixed(5)} total`);
