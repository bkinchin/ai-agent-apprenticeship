// What a conversation costs.
//
// Every model call is recorded here, tagged with which model made it and
// what it was for. Nothing else in the system knows about money.
//
// Two numbers matter, and they are not the same:
//
//   cost per CONVERSATION  — what you spend per attempt
//   cost per RESOLUTION    — what you spend per outcome achieved
//
// An agent costing £0.03 a conversation that resolves 40% of them costs
// £0.075 per resolution. That second number is the one a CFO asks for,
// and the one most teams cannot produce.

/** USD per million tokens. Keep in step with the provider's pricing page. */
export const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

export type Purpose = "agent" | "guard";

export interface CallRecord {
  model: string;
  /** "agent" = the conversation itself. "guard" = a classifier. */
  purpose: Purpose;
  label: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export const callLog: CallRecord[] = [];

export function recordCall(
  model: string,
  purpose: Purpose,
  label: string,
  usage: { input_tokens: number; output_tokens: number },
): void {
  const price = PRICING[model] ?? { in: 0, out: 0 };
  callLog.push({
    model,
    purpose,
    label,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    usd: (usage.input_tokens / 1e6) * price.in + (usage.output_tokens / 1e6) * price.out,
  });
}

export interface CostSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Split by what the spend was FOR — the interesting breakdown. */
  byPurpose: Record<Purpose, { calls: number; usd: number }>;
}

/** A marker you can pass to `since()` to scope a measurement. */
export function mark(): number {
  return callLog.length;
}

export function since(from: number): CostSummary {
  const slice = callLog.slice(from);
  const byPurpose: CostSummary["byPurpose"] = {
    agent: { calls: 0, usd: 0 },
    guard: { calls: 0, usd: 0 },
  };
  for (const c of slice) {
    byPurpose[c.purpose].calls++;
    byPurpose[c.purpose].usd += c.usd;
  }
  return {
    calls: slice.length,
    inputTokens: slice.reduce((a, c) => a + c.inputTokens, 0),
    outputTokens: slice.reduce((a, c) => a + c.outputTokens, 0),
    usd: slice.reduce((a, c) => a + c.usd, 0),
    byPurpose,
  };
}

export const gbp = (usd: number) => usd * 0.79; // rough, for readability
