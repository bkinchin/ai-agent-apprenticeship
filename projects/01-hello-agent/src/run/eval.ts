// Run the golden set.
//   npm run eval              all cases
//   npm run eval attack       only cases whose id contains "attack"

import { reportRepeated, runRepeated, type RepeatedResult } from "../core/eval.js";
import { GOLDEN_SET } from "../eval/golden-set.js";
import { loadPolicy } from "../core/policy.js";

// npm run eval [filter] [--runs N]
const args = process.argv.slice(2);
const runsFlag = args.indexOf("--runs");
const RUNS = runsFlag === -1 ? 1 : Number(args[runsFlag + 1] ?? 3);
const JUDGE = args.includes("--judge");
const filter = args.find((a) => !a.startsWith("--") && a !== String(RUNS));
const cases = filter ? GOLDEN_SET.filter((c) => c.id.includes(filter)) : GOLDEN_SET;

if (cases.length === 0) {
  console.error(`No cases matching "${filter}"`);
  process.exit(1);
}

const policy = loadPolicy();
console.log(`\nrunning ${cases.length} case(s) × ${RUNS} run(s)${JUDGE ? " with quality judging" : ""}...`);

const results: RepeatedResult[] = [];
for (const c of cases) {
  process.stdout.write(`  ${c.id} ... `);
  const r = await runRepeated(c, policy, RUNS, JUDGE);
  console.log(`${r.passed}/${r.runs}${r.flaky ? " FLAKY" : ""}`);
  results.push(r);
}

process.exit(reportRepeated(results) ? 0 : 1);
