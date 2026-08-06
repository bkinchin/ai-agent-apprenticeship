// Two ways of handling data that arrives from outside your program.
// Run: npx tsx src/validation-demo.ts        (no API key needed)

import { z } from "zod";
//console.log(z.email());

// Five things the model might send as arguments to find_customer.
// Only the first is what we actually want.
const fromModel: unknown[] = [
  { email: "billy@example.com" }, // correct
  { email: 12345 }, // a number, not a string
  { emial: "billy@example.com" }, // key is misspelled
  {}, // empty object
  "billy@example.com", // a string, not an object
];

// ══════════════════════════════════════════════════════════════════
// WAY 1 — `as`.  What you've been doing.
// ══════════════════════════════════════════════════════════════════

console.log("\nWAY 1 — using `as`\n");

for (const input of fromModel) {
  // This line does NOTHING at runtime. It only tells the compiler
  // "assume this is an object with a string called email".
  const { email } = input as { email: string };

  console.log(`  ${JSON.stringify(input).padEnd(34)} →  email = ${email}`);
}

// ══════════════════════════════════════════════════════════════════
// WAY 2 — a Zod schema.
// ══════════════════════════════════════════════════════════════════

// This is a VALUE, not a type. It's an object stored in a variable,
// and it still exists when the program runs.
//
//   z.object({...})  →  "should be an object with these fields"
//   z.email()        →  "should be a string that looks like an email"
//
const FindCustomerArgs = z.object({
  email: z.email(),
});
console.log("FindCustomerArgs:", FindCustomerArgs);

console.log("\nWAY 2 — using a Zod schema\n");

for (const input of fromModel) {
  // .safeParse() checks the data and hands back a result.
  // It never throws — it reports.
  console.log(FindCustomerArgs);
  const result = FindCustomerArgs.safeParse(input);

  if (result.success) {
    // Inside here, result.data is checked AND typed.
    console.log(`  ✓  ${JSON.stringify(input).padEnd(34)} →  ${result.data.email}`);
  } else {
    // result.error.issues is a list of what was wrong.
    console.log(
      `  ✗  ${JSON.stringify(input).padEnd(34)} →  ${result.error.issues[0]!.message}`,
    );
  }
}

console.log("");
