// Read a trace.
//
//   npm run trace                    recent conversations
//   npm run trace <sessionId>        the tree, with timings and costs
//   npm run trace <sessionId> full   every input and output, unabridged
//
// THE BAR THE CURRICULUM SETS: hand this to somebody who was not there
// and have them explain the outcome. That is what it is for — not
// admiring the tree, but answering "why did it do that" three weeks
// later, when re-running is not an option because the reasoning varies
// run to run.

import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.TRACE_DB ?? ".traces.db");
const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;
const arg = process.argv[2];
const full = process.argv[3] === "full";

interface Row {
  spanId: string; traceId: string; parentId: string | null; sessionId: string; subject: string;
  type: string; name: string; startedAt: string; durationMs: number;
  tokensIn: number; tokensOut: number; costAud: number; outcome: string;
  modelVersion: string; promptVersion: string; policyVersion: string; corpusVersion: string;
  payload: string;
}

// FILTERING, because narrowing is the whole job.
//
//   npm run trace --abstained     conversations where it declined
//   npm run trace --denied        where a guard fired
//   npm run trace --errors        where something failed
//   npm run trace guest           whose question matched "guest"
//
// Added during a debugging exercise, on the third occasion of scrolling
// a list looking for the two rows that mattered. A viewer that can only
// list is a viewer that stops being used at twenty rows.
const FLAGS = ["--abstained", "--denied", "--errors"];
const flag = process.argv.slice(2).find((a) => FLAGS.includes(a));
const search = process.argv[2] && !process.argv[2].startsWith("--") && !process.argv[2].startsWith("s-")
  ? process.argv[2]
  : undefined;

if (!arg || flag || search) {
  // WHAT THE CONVERSATION WAS ABOUT, not just that it happened.
  //
  // The first version listed ten sessions with a cost each, which told
  // you nothing you could act on — finding the two conversations where
  // the agent declined meant opening all ten. Found by using it: the
  // exercise asks "what data did you wish you had? Add it."
  const rows = db.prepare(
    `SELECT sessionId, MIN(startedAt) AS at, COUNT(*) AS spans,
            SUM(costAud) AS cost,
            SUM(outcome = 'denied') AS denied,
            SUM(outcome = 'error') AS errors,
            SUM(payload LIKE '%not_in_knowledge_base%') AS abstained,
            MIN(CASE WHEN type = 'turn' THEN payload END) AS firstTurn
     FROM spans GROUP BY sessionId ORDER BY at DESC LIMIT 20`,
  ).all() as Record<string, string | number>[];

  const matching = rows.filter((r) => {
    if (flag === "--abstained" && !Number(r.abstained)) return false;
    if (flag === "--denied" && !Number(r.denied)) return false;
    if (flag === "--errors" && !Number(r.errors)) return false;
    if (search && !String(r.firstTurn ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const label = flag ?? (search ? `matching "${search}"` : "recent");
  console.log(`\n${matching.length} ${label} conversation(s)\n`);
  for (const r of matching) {
    let asked = "";
    try {
      asked = String((JSON.parse(String(r.firstTurn ?? "{}")) as { input?: string }).input ?? "");
    } catch {
      asked = "";
    }
    const flags = [
      Number(r.abstained) ? "\x1b[33mabstained\x1b[0m" : "",
      Number(r.denied) ? "\x1b[33mdenied\x1b[0m" : "",
      Number(r.errors) ? "\x1b[31merrors\x1b[0m" : "",
    ].filter(Boolean).join(" ");
    console.log(
      `  ${String(r.at).slice(5, 16).replace("T", " ")}  ${String(r.sessionId).padEnd(24)}` +
        `$${Number(r.cost).toFixed(4)}  ${flags}`,
    );
    console.log(`  ${dim(`             ${asked.slice(0, 72)}`)}`);
  }
  console.log(`\n${dim("npm run trace <sessionId>        the tree")}`);
  console.log(`${dim("npm run trace <sessionId> full   with every input and output")}`);
  console.log(`${dim("npm run trace --abstained        only where it declined")}`);
  console.log(`${dim("npm run trace <word>             only questions matching a word")}\n`);
  process.exit(0);
}

const rows = db.prepare(
  `SELECT * FROM spans WHERE sessionId = ? OR traceId = ? ORDER BY startedAt`,
).all(arg, arg) as unknown as Row[];

if (rows.length === 0) {
  console.error(`no spans for ${arg}`);
  process.exit(1);
}

const first = rows[0]!;
const cost = rows.reduce((n, r) => n + r.costAud, 0);
const tokens = rows.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
const wall = rows.filter((r) => r.type === "turn").reduce((n, r) => n + r.durationMs, 0);

console.log(`\n\x1b[1mtrace\x1b[0m  ${first.traceId.slice(0, 8)}   session ${first.sessionId}`);
console.log(`       member ${first.subject}   ${rows.length} spans   ${(wall / 1000).toFixed(1)}s   $${cost.toFixed(4)}   ${tokens.toLocaleString()} tokens`);
// VERSIONS ON THE HEADER. When quality drops on a Tuesday, this is the
// line you compare against last week's trace.
console.log(dim(`       model ${first.modelVersion}  prompt ${first.promptVersion}  policy ${first.policyVersion}  corpus ${first.corpusVersion}`));

const kids = (id: string | null) => rows.filter((r) => r.parentId === id);
const colour = (o: string) => (o === "error" ? "31" : o === "denied" ? "33" : "32");

function render(r: Row, depth: number): void {
  const pad = "  ".repeat(depth + 1);
  const money = r.costAud > 0 ? `  $${r.costAud.toFixed(4)}` : "";
  const tok = r.tokensIn ? `  ${(r.tokensIn + r.tokensOut).toLocaleString()} tok` : "";
  console.log(
    `${pad}\x1b[${colour(r.outcome)}m●\x1b[0m ${r.type.padEnd(10)} ${r.name.padEnd(24)}` +
      dim(`${String(r.durationMs).padStart(6)}ms${tok}${money}`),
  );

  const p = JSON.parse(r.payload) as { input: unknown; output: unknown; error?: string; redacted: string[] };
  if (p.error) console.log(`${pad}  \x1b[31m${p.error}\x1b[0m`);
  if (p.redacted.length) console.log(`${pad}  ${dim(`redacted: ${p.redacted.join(", ")}`)}`);

  const show = (label: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const text = typeof v === "string" ? v : JSON.stringify(v, null, full ? 2 : 0);
    const clipped = full ? text : text.slice(0, 160) + (text.length > 160 ? "…" : "");
    console.log(`${pad}  ${dim(label)} ${clipped.replace(/\n/g, `\n${pad}    `)}`);
  };
  show("in ", p.input);
  show("out", p.output);

  for (const k of kids(r.spanId)) render(k, depth + 1);
}

console.log("");
for (const root of kids(null)) render(root, 0);
console.log("");
