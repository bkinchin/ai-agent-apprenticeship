// Measures what a conversation costs as it grows.
//
// No text is generated — this only COUNTS tokens, using the API's own
// counter rather than an estimate. Cheap to run, exact numbers.
//
//   npx tsx --env-file=../../.env.local src/cost-curve.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = "claude-opus-5";
const PRICE_IN = 5.0; // USD per million input tokens

const SYSTEM = "You are a helpful assistant. Keep your replies to two sentences.";

// Stand-ins for a real conversation. Roughly the length of a typical
// support exchange: a short question, a longer answer.
const USER_TURN = "Can you tell me a bit more about how that works in practice?";
const ASSISTANT_TURN =
  "Of course. The short version is that it depends on your plan tier and " +
  "when you signed up, because the terms changed in March. If you let me " +
  "know which plan you're on I can give you the specifics for your account.";

const TURNS = 30;
const WINDOW = 6; // sliding window: keep the last 6 messages

async function countTokens(messages: Anthropic.MessageParam[]): Promise<number> {
  const { input_tokens } = await client.messages.countTokens({
    model: MODEL,
    system: SYSTEM,
    messages,
  });
  return input_tokens;
}

const history: Anthropic.MessageParam[] = [];
let cumulativeFull = 0;
let cumulativeWindowed = 0;

console.log(
  "\n turn │ msgs │  full history  │  window(6)  │  cumulative full  │  cumulative windowed",
);
console.log(
  "──────┼──────┼────────────────┼─────────────┼───────────────────┼─────────────────────",
);

for (let turn = 1; turn <= TURNS; turn++) {
  history.push({ role: "user", content: USER_TURN });

  const full = await countTokens(history);
  const windowed = await countTokens(history.slice(-WINDOW));

  cumulativeFull += full;
  cumulativeWindowed += windowed;

  if (turn % 5 === 0 || turn === 1) {
    console.log(
      ` ${String(turn).padStart(4)} │ ${String(history.length).padStart(4)} │` +
        ` ${String(full).padStart(9)} tok │ ${String(windowed).padStart(6)} tok │` +
        ` ${String(cumulativeFull).padStart(9)} tok     │ ${String(cumulativeWindowed).padStart(9)} tok`,
    );
  }

  history.push({ role: "assistant", content: ASSISTANT_TURN });
}

const costFull = (cumulativeFull / 1e6) * PRICE_IN;
const costWindowed = (cumulativeWindowed / 1e6) * PRICE_IN;

console.log(`\nAfter ${TURNS} turns:`);
console.log(`  full history      ${cumulativeFull.toLocaleString()} input tokens · $${costFull.toFixed(4)}`);
console.log(`  sliding window(6) ${cumulativeWindowed.toLocaleString()} input tokens · $${costWindowed.toFixed(4)}`);
console.log(`  ratio             ${(cumulativeFull / cumulativeWindowed).toFixed(1)}× more expensive\n`);

console.log("At 100,000 conversations/day:");
console.log(`  full history      $${(costFull * 100_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} / day`);
console.log(`  sliding window(6) $${(costWindowed * 100_000).toLocaleString(undefined, { maximumFractionDigits: 0 })} / day\n`);
