// The dashboard.
//
//   npm run metrics            last 24h against the previous 7 days
//   npm run metrics 7d         a longer window
//
// No model calls, no network. Everything is a query over spans.

import { alerts, compute } from "../observe/metrics.js";

const dim = (t: string) => `\x1b[2m${t}\x1b[0m`;
const arg = process.argv[2] ?? "24h";
const hours = arg.endsWith("d") ? Number(arg.slice(0, -1)) * 24 : Number(arg.replace("h", "")) || 24;

const now = compute({ since: new Date(Date.now() - hours * 3600e3).toISOString(), label: arg });
// The baseline is the SEVEN DAYS BEFORE the window, so "vs baseline"
// compares like with like rather than with an all-time average that
// includes the period you are worried about.
const baseline = compute({
  since: new Date(Date.now() - (hours + 7 * 24) * 3600e3).toISOString(),
  label: "prior 7d",
});

const pc = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (k: string, v: string, note = "") => console.log(`  ${k.padEnd(28)}${v.padStart(12)}  ${dim(note)}`);

console.log(`\n\x1b[1mlast ${arg}\x1b[0m   ${now.conversations} conversations · ${now.turns} turns\n`);

console.log(dim("  QUALITY  ── lagging: you already have a problem"));
row("escalation rate", pc(now.escalationRate), Object.entries(now.escalationsByReason).map(([k, v]) => `${k}=${v}`).join(" "));
row("abstention rate", pc(now.abstentionRate), "the knowledge branch declining");
row("bad citation rate", pc(now.badCitationRate), "cited something unverifiable");

console.log(dim("\n  BEHAVIOUR  ── leading: it is struggling before it is failing"));
row("steps per conversation", now.stepsPerConversation.toFixed(1), Object.entries(now.toolCalls).map(([k, v]) => `${k}=${v}`).join(" "));
row("denied tool calls", pc(now.deniedRate), "guards firing");
row("loop rate", pc(now.loopRate));

console.log(dim("\n  COST"));
row("per conversation", `$${now.costPerConversation.toFixed(4)}`);
row("tokens per conversation", Math.round(now.tokensPerConversation).toLocaleString());
row("resolution rate", pc(now.resolutionRate), "did not escalate");
row("per resolution", `$${now.costPerResolution.toFixed(4)}`, "← the number a CFO asks for");

console.log(dim("\n  RELIABILITY"));
row("turn latency p50", `${now.latencyMs.p50}ms`);
row("turn latency p95", `${now.latencyMs.p95}ms`);
row("turn latency p99", `${now.latencyMs.p99}ms`);
for (const [tool, rate] of Object.entries(now.toolErrorRate)) {
  if (rate > 0) row(`${tool} errors`, pc(rate));
}

const fired = alerts(now, baseline).filter((a) => a.fired);
console.log("");
if (fired.length === 0) {
  console.log(dim("  no alerts firing\n"));
} else {
  console.log(`  \x1b[1m${fired.length} alert(s) firing\x1b[0m\n`);
  for (const a of fired) {
    const c = a.severity === "critical" ? "31" : a.severity === "high" ? "33" : "2";
    console.log(`  \x1b[${c}m${a.severity.toUpperCase().padEnd(9)}\x1b[0m ${a.name}`);
    console.log(`            ${a.detail}`);
    console.log(`            ${dim(`→ ${a.audience} · ${a.runbook}`)}`);
  }
  console.log("");
}
