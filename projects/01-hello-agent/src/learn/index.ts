// Hello Agent — day 1.
// A chat loop. ~50 lines. Read it top to bottom; nothing here is clever.

import readline from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import { assemble } from "../core/context.js";
import { SqliteSessionStore } from "../core/sqlite-store.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
const MODEL = "claude-opus-5";

const FORGET = process.argv.includes("--forget");
const VERBOSE = process.argv.includes("--verbose");

// --session carries a VALUE, so we find where it is and take the next word.
// (--forget is just present-or-absent, which is why .includes() was enough.)
const sessionFlagAt = process.argv.indexOf("--session");
const SESSION_ID = sessionFlagAt === -1 ? undefined : process.argv[sessionFlagAt + 1];

const SYSTEM =
  "You are a helpful assistant. Keep your replies to two sentences.";
//const SYSTEM = "You are a grumpy Scottish golf club secretary. Be brief.";

// State no longer lives in this process. It lives in a file, and we
// borrow it for the duration of the run.
const store = new SqliteSessionStore();

const session = SESSION_ID ? await store.load(SESSION_ID) : await store.create();

if (!session) {
  // Fail loudly. Silently starting a fresh conversation when the user asked
  // for a specific one is worse than an error.
  console.error(`No session found with id ${SESSION_ID}`);
  process.exit(1);
}

let totalCost = 0;
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.on("close", () => process.exit(0)); // ctrl-D / end of input

console.log(
  `${MODEL}${FORGET ? "  [--forget]" : ""}${VERBOSE ? "  [--verbose]" : ""}`,
);
console.log(
  SESSION_ID
    ? `resumed session ${session.id} — ${session.history.length} messages already`
    : `new session ${session.id}`,
);
console.log(`resume later with:  npm start -- --session ${session.id}`);
console.log("type /exit to quit\n");

while (true) {
  const input = (await rl.question("you › ")).trim();
  if (!input) continue;
  if (input === "/exit") break;

  const nameMatch = input.match(/my name is (\w+)/i);
  if (nameMatch) session.taskState.name = nameMatch[1]!;

  session.history.push({ role: "user", content: input });

  // What we send. Normally the whole conversation; with --forget, only the
  // latest message — which is what the model would see if we kept no history.
  //const messages = FORGET ? history.slice(-1) : history;
  const WINDOW = 2;
  const { system, messages } = assemble({
    systemPrompt: SYSTEM,
    taskState: session.taskState,
    history: session.history,
    window: WINDOW,
  });
  //const messages = FORGET ? history.slice(-1) : history.slice(-WINDOW);

  if (VERBOSE) {
    console.log("\n┌─ sending ────────────────────");
    console.log("system:", system); // the ASSEMBLED prompt, not the base one
    console.dir(messages, { depth: null });
    console.log("└──────────────────────────────\n");
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "disabled" }, // on by default; not needed today
    system: system, // note: a separate field, NOT a message
    messages,
  });

  // response.content is an array of typed blocks, not a string.
  // Today it holds only text. On day 3 it will also hold tool calls.
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  session.history.push({ role: "assistant", content: text });

  // Write to disk NOW, not at exit. If the process is killed mid-conversation
  // the user loses at most the current turn, not the whole thing.
  await store.save(session);

  const { input_tokens, output_tokens } = response.usage;
  const cost = (input_tokens / 1e6) * 5 + (output_tokens / 1e6) * 25;
  totalCost += cost;

  console.log(`\nclaude › ${text}`);
  console.log(
    `          in ${input_tokens} · out ${output_tokens} · $${totalCost.toFixed(5)} so far\n`,
  );
}

rl.close();
