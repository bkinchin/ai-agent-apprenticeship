// The four metric families, computed from the trace store.
//
// COMPUTED, NOT COUNTED SEPARATELY. A counter incremented beside the
// code it measures drifts from it — somebody adds a return path and
// forgets the counter, and the metric quietly becomes a different
// metric. Everything here is a query over spans that were emitted by
// the work itself.
//
// LEADING VERSUS LAGGING is the distinction that carries the value.
// Task success falling means you already have a problem. Steps per
// conversation creeping up means you have days. Alert on the second,
// report on the first — a team that only watches task success finds
// out from customers.

import { DatabaseSync } from "node:sqlite";

export interface Window {
  /** ISO timestamp; spans at or after this are included. */
  since: string;
  label: string;
}

export interface Metrics {
  window: Window;
  conversations: number;
  turns: number;

  // ── quality: is it doing the job? (mostly lagging)
  escalationRate: number;
  escalationsByReason: Record<string, number>;
  abstentionRate: number;
  badCitationRate: number;

  // ── behaviour: is it struggling? (leading)
  stepsPerConversation: number;
  toolCalls: Record<string, number>;
  deniedRate: number;
  loopRate: number;

  // ── cost
  costPerConversation: number;
  tokensPerConversation: number;
  /** THE number a CFO asks for. Cost per conversation ÷ resolution rate. */
  costPerResolution: number;
  resolutionRate: number;

  // ── reliability
  toolErrorRate: Record<string, number>;
  latencyMs: { p50: number; p95: number; p99: number };
}

const pct = (n: number, d: number) => (d === 0 ? 0 : n / d);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

export function compute(window: Window, path = process.env.TRACE_DB ?? ".traces.db"): Metrics {
  const db = new DatabaseSync(path);
  const rows = db
    .prepare(`SELECT * FROM spans WHERE startedAt >= ? ORDER BY startedAt`)
    .all(window.since) as unknown as {
      sessionId: string; type: string; name: string; outcome: string;
      durationMs: number; tokensIn: number; tokensOut: number; costAud: number; payload: string;
    }[];

  const sessions = new Set(rows.map((r) => r.sessionId));
  const turns = rows.filter((r) => r.type === "turn");
  const tools = rows.filter((r) => r.type === "tool" || r.type === "knowledge");
  const escalations = rows.filter((r) => r.type === "escalation");

  const byReason: Record<string, number> = {};
  for (const e of escalations) byReason[e.name] = (byReason[e.name] ?? 0) + 1;

  const toolCalls: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  for (const t of tools) {
    toolCalls[t.name] = (toolCalls[t.name] ?? 0) + 1;
    if (t.outcome === "error") toolErrors[t.name] = (toolErrors[t.name] ?? 0) + 1;
  }
  const toolErrorRate: Record<string, number> = {};
  for (const [name, n] of Object.entries(toolCalls)) {
    toolErrorRate[name] = pct(toolErrors[name] ?? 0, n);
  }

  // Abstention: the knowledge agent declining. Not a failure — the
  // branch working — but a RATE that moves means the corpus or the
  // questions changed.
  const asks = rows.filter((r) => r.type === "knowledge" && r.name === "ask");
  const abstained = asks.filter((r) => r.payload.includes('"not_in_knowledge_base"'));
  const badCites = asks.filter((r) => /"bad":\[\{/.test(r.payload));

  // A conversation is RESOLVED if it never escalated. Crude, and
  // honest about being crude: a member who gave up is counted as
  // resolved, which is the direction that flatters us — so the true
  // rate is at best this.
  const escalatedSessions = new Set(escalations.map((e) => e.sessionId));
  const resolutionRate = pct(sessions.size - escalatedSessions.size, sessions.size);

  const cost = rows.reduce((n, r) => n + r.costAud, 0);
  const tokens = rows.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0);
  const costPerConversation = pct(cost, sessions.size);

  const latencies = turns.map((t) => t.durationMs).sort((a, b) => a - b);

  db.close();
  return {
    window,
    conversations: sessions.size,
    turns: turns.length,
    escalationRate: pct(escalatedSessions.size, sessions.size),
    escalationsByReason: byReason,
    abstentionRate: pct(abstained.length, asks.length),
    badCitationRate: pct(badCites.length, asks.length),
    stepsPerConversation: pct(tools.length, sessions.size),
    toolCalls,
    deniedRate: pct(tools.filter((t) => t.outcome === "denied").length, tools.length),
    loopRate: pct(escalations.filter((e) => e.name === "went_in_circles").length, sessions.size),
    costPerConversation,
    tokensPerConversation: pct(tokens, sessions.size),
    // COST PER RESOLUTION. An agent at $0.03 a conversation resolving
    // 40% costs $0.075 per resolution — and that is the figure to put
    // beside a member of staff doing the same job.
    costPerResolution: resolutionRate === 0 ? 0 : costPerConversation / resolutionRate,
    resolutionRate,
    toolErrorRate,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
  };
}

// ── alerts ──────────────────────────────────────────────────────

export interface Alert {
  name: string;
  severity: "critical" | "high" | "medium";
  /** Who is on the end of this, and can act on it. */
  audience: "agent-owner" | "pro-shop";
  fired: boolean;
  detail: string;
  runbook: string;
}

/**
 * Evaluate the alerts against a window, with a baseline to compare to.
 *
 * EVERY ALERT NAMES ITS AUDIENCE. The PRD makes the Pro Shop Manager
 * accountable for agent behaviour, and handed "schema validation
 * failure rate exceeded 1%" they can do nothing — they are one person
 * running a shop. An alert nobody can action is noise, and noise trains
 * people to ignore alerts.
 */
export function alerts(now: Metrics, baseline?: Metrics): Alert[] {
  const out: Alert[] = [];
  const add = (a: Alert) => out.push(a);

  add({
    name: "bad_citations",
    severity: "critical",
    audience: "agent-owner",
    fired: now.badCitationRate > 0,
    detail: `${(now.badCitationRate * 100).toFixed(1)}% of answers cited something that could not be verified`,
    runbook: "runbook.md#bad_citations",
  });

  add({
    name: "escalation_rate_spike",
    severity: "high",
    audience: "agent-owner",
    fired: baseline !== undefined && now.escalationRate > baseline.escalationRate * 1.5 && now.conversations >= 5,
    detail: `${(now.escalationRate * 100).toFixed(0)}% vs baseline ${((baseline?.escalationRate ?? 0) * 100).toFixed(0)}%`,
    runbook: "runbook.md#escalation_rate_spike",
  });

  add({
    name: "steps_per_conversation",
    severity: "high",
    audience: "agent-owner",
    // THE EARLIEST LEADING INDICATOR. It is struggling before it is
    // failing, and this moves first.
    fired: baseline !== undefined && now.stepsPerConversation > baseline.stepsPerConversation * 1.5 && now.conversations >= 5,
    detail: `${now.stepsPerConversation.toFixed(1)} tool calls per conversation vs ${(baseline?.stepsPerConversation ?? 0).toFixed(1)}`,
    runbook: "runbook.md#steps_per_conversation",
  });

  add({
    name: "cost_per_conversation",
    severity: "high",
    audience: "agent-owner",
    fired: baseline !== undefined && now.costPerConversation > baseline.costPerConversation * 2 && now.conversations >= 5,
    detail: `$${now.costPerConversation.toFixed(4)} vs $${(baseline?.costPerConversation ?? 0).toFixed(4)}`,
    runbook: "runbook.md#cost_per_conversation",
  });

  add({
    name: "loop_detection",
    severity: "medium",
    audience: "agent-owner",
    fired: now.loopRate > 0.05 && now.conversations >= 5,
    detail: `${(now.loopRate * 100).toFixed(0)}% of conversations went in circles`,
    runbook: "runbook.md#loop_detection",
  });

  for (const [tool, rate] of Object.entries(now.toolErrorRate)) {
    if (rate > 0.05) {
      add({
        name: `tool_error_rate:${tool}`,
        severity: "high",
        audience: "agent-owner",
        fired: true,
        detail: `${tool} failing ${(rate * 100).toFixed(0)}% of calls`,
        runbook: "runbook.md#tool_error_rate",
      });
    }
  }

  // THE ONE THE PRO SHOP CAN ACT ON. Operational, in club language, and
  // the only alert on this list that ends in somebody making a phone
  // call rather than reading a dashboard.
  add({
    name: "urgent_escalation_waiting",
    severity: "critical",
    audience: "pro-shop",
    fired: (now.escalationsByReason.bereavement ?? 0) + (now.escalationsByReason.distress ?? 0) > 0,
    detail: `${(now.escalationsByReason.bereavement ?? 0) + (now.escalationsByReason.distress ?? 0)} member(s) need a personal call`,
    runbook: "runbook.md#urgent_escalation_waiting",
  });

  return out;
}
