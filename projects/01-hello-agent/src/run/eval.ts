// Run the golden set.
//   npm run eval              all cases
//   npm run eval attack       only cases whose id contains "attack"

import { report, runCase, type CaseResult } from "../core/eval.js";
import { GOLDEN_SET } from "../eval/golden-set.js";
import { loadPolicy } from "../core/policy.js";

const filter = process.argv[2];
const cases = filter ? GOLDEN_SET.filter((c) => c.id.includes(filter)) : GOLDEN_SET;

if (cases.length === 0) {
  console.error(`No cases matching "${filter}"`);
  process.exit(1);
}

const policy = loadPolicy();
console.log(`\nrunning ${cases.length} case(s)...`);

const results: CaseResult[] = [];
for (const c of cases) {
  process.stdout.write(`  ${c.id} ... `);
  const r = await runCase(c, policy);
  console.log(r.pass ? "ok" : "FAIL");
  results.push(r);
}

process.exit(report(results) ? 0 : 1);
