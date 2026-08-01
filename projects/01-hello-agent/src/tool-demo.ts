// One tool call, with every stage printed.
// Run: npx tsx --env-file=../../.env.local src/tool-demo.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-opus-5";

// ── 1. Describe the tool to the model ────────────────────────────
// This is DESCRIPTION only. We are not giving the model a function —
// we are telling it that one exists, and what it's for.
const tools: Anthropic.Tool[] = [
  {
    name: "get_current_time",
    description:
      "Get the current date and time in a given IANA timezone. " +
      "Use this whenever the user asks what time it is.",
    input_schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone, e.g. Europe/London or America/New_York",
        },
      },
      required: ["timezone"],
    },
  },
];

// ── 2. The actual function. This is OURS. The model never touches it.
function getCurrentTime(timezone: string): string {
  // "sv-SE" formats as YYYY-MM-DD HH:mm:ss — ISO 8601 order, one possible
  // reading. "en-GB" gives DD/MM/YYYY, which the model read as MM/DD/YYYY.
  // Do NOT use toISOString() here: it always returns UTC and would silently
  // ignore the timezone argument.
  return new Date().toLocaleString("sv-SE", { timeZone: timezone });
}

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "What time is it in Tokyo right now?" },
];

// ── 3. First call ────────────────────────────────────────────────
console.log("═══ CALL 1 ═══════════════════════════════════════");
console.log("we send:", JSON.stringify(messages, null, 2));

const first = await client.messages.create({
  model: MODEL,
  max_tokens: 1024,
  // NOTE: no `thinking: { type: "disabled" }` here — see below.
  // Opus 5 thinks by default, and disabling it breaks tool calling.
  tools,
  messages,
});

console.log("\nmodel replies:");
console.log("  stop_reason:", first.stop_reason);
console.dir(first.content, { depth: null });

// ── 4. Find what it asked for ────────────────────────────────────
const toolUse = first.content.find(
  (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
);

if (!toolUse) {
  // Don't just say "no tool requested" — check whether the model CLAIMED to
  // want one. If stop_reason says tool_use but there's no tool_use block,
  // something is wrong and you want to know, loudly.
  if (first.stop_reason === "tool_use") {
    console.error("\n!! stop_reason is tool_use but no tool_use block exists.");
    console.error("!! The model wrote the call as text. Nothing was executed.");
    process.exit(1);
  }
  console.log("\nModel answered directly, no tool needed.");
  process.exit(0);
}

console.log(`\n═══ WE EXECUTE ═══════════════════════════════════`);
console.log(`  tool: ${toolUse.name}`);
console.log(`  args:`, toolUse.input);

const args = toolUse.input as { timezone: string };
const result = getCurrentTime(args.timezone); // ← OUR code runs. Not the model's.

console.log(`  result: ${result}`);

// ── 5. Send the result back ──────────────────────────────────────
// The assistant's turn (containing the request) goes back verbatim,
// then the result — note it goes in a USER message.
messages.push({ role: "assistant", content: first.content });
messages.push({
  role: "user",
  content: [
    {
      type: "tool_result",
      tool_use_id: toolUse.id, // must match the id from the request
      content: result,
    },
  ],
});

console.log(`\n═══ CALL 2 ═══════════════════════════════════════`);
console.log("we send back:", JSON.stringify(messages.slice(-2), null, 2));

const second = await client.messages.create({
  model: MODEL,
  max_tokens: 1024,
  // NOTE: no `thinking: { type: "disabled" }` here — see below.
  // Opus 5 thinks by default, and disabling it breaks tool calling.
  tools,
  messages,
});

console.log("\nmodel replies:");
console.log("  stop_reason:", second.stop_reason);
console.log(
  "  text:",
  second.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(""),
);
