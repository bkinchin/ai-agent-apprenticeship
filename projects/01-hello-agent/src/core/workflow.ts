// The state machine. Pure functions only — no API calls, no database,
// no console output. Everything here is testable in milliseconds.

export type Stage =
  | "GREETING"
  | "VERIFICATION"
  | "INSPECTION"
  | "RETENTION"
  | "CONFIRMATION"
  | "EXECUTION"
  | "COMPLETE"
  | "ESCALATED"; // handed to a human. Terminal.

/** Facts your CODE has established. Never things the model claimed. */
export interface TaskState {
  /** Set only after your code compared two values and they matched. */
  verifiedCustomerId?: string;
  /**
   * The customer gave a date code cannot read one way — "02/04/1979" is
   * 2 April here and 4 February in the US.
   *
   * While this is set, verify_identity is REMOVED from the tool list.
   * Not discouraged in the prompt — removed, because on 2026-08-07 the
   * agent asked twice, was pushed a third time, and guessed. It picked
   * correctly and disclosed the subscription.
   *
   * The lesson was about where the guess happened: the model was
   * CONSTRUCTING a verification credential out of ambiguous text before
   * any code saw it. Everything downstream compared exactly and
   * correctly against a value that had been decided by a coin flip.
   */
  ambiguousDob?: { raw: string; readings: [string, string] };
  /** Set only after get_subscription actually returned. */
  subscriptionInspected: boolean;
  /** Set only after offer_retention actually ran. */
  retentionOffered?: boolean;
  /** Set only when the customer explicitly turned the offer down. */
  retentionDeclined?: boolean;
  /**
   * Set only from a user turn that arrived AFTER the agent described
   * this exact action. Records WHAT was confirmed, not just that
   * something was.
   */
  confirmedAction?: { tool: string; customerId: string };
  /**
   * Set only when the write tool actually ran and returned. Without this,
   * COMPLETE can be reached having done nothing — the stage would report
   * success that the world doesn't reflect.
   */
  executedAction?: { tool: string; customerId: string };
  /** Set by escalate_to_human. The agent's own way out. */
  escalated?: { reason: string; summary: string };
}

/** Which tools exist in each stage. Anything not listed cannot be called. */
const ALWAYS = ["escalate_to_human"]; // the agent's exit, from anywhere

export const STAGE_TOOLS: Record<Stage, string[]> = {
  GREETING: ["verify_identity", ...ALWAYS],
  VERIFICATION: ["verify_identity", ...ALWAYS],
  INSPECTION: ["get_subscription", ...ALWAYS],
  RETENTION: ["offer_retention", "apply_retention", ...ALWAYS],
  CONFIRMATION: [...ALWAYS], // otherwise a stuck customer has no way out
  EXECUTION: ["cancel_subscription", ...ALWAYS],
  COMPLETE: [],
  ESCALATED: [], // a human has it now
};

/** The forward path. Anything not listed is illegal by omission. */
const FORWARD_MOVES: Record<Stage, Stage[]> = {
  GREETING: ["VERIFICATION"],
  VERIFICATION: ["INSPECTION"],
  INSPECTION: ["RETENTION"],
  RETENTION: ["CONFIRMATION", "COMPLETE"], // decline -> cancel, or accept -> done
  CONFIRMATION: ["EXECUTION"],
  EXECUTION: ["COMPLETE"],
  COMPLETE: [],
  ESCALATED: [],
};

/** Escape hatches. Reachable from anywhere that isn't already an end. */
const EXITS: Stage[] = ["ESCALATED"];
const TERMINAL: Stage[] = ["COMPLETE", "ESCALATED"];

const ALLOWED_MOVES: Record<Stage, Stage[]> = Object.fromEntries(
  (Object.keys(FORWARD_MOVES) as Stage[]).map((from) => [
    from,
    TERMINAL.includes(from) ? FORWARD_MOVES[from] : [...FORWARD_MOVES[from], ...EXITS],
  ]),
) as Record<Stage, Stage[]>;

/**
 * Going backwards means discarding what got you here.
 *
 * If a customer says "wrong account", you cannot keep verifiedCustomerId
 * — they would be verified as one person while discussing another.
 * Returns a fresh state; never mutates.
 */
export function restart(): TaskState {
  return { subscriptionInspected: false };
}

export type Guard = { ok: true } | { ok: false; reason: string };

export function canTransition(from: Stage, to: Stage, state: TaskState): Guard {
  // 1. Is this move on the map at all?
  if (!ALLOWED_MOVES[from].includes(to)) {
    return { ok: false, reason: `${from} → ${to} is not a legal transition.` };
  }

  // 2. Preconditions for entering each stage.
  if (to === "INSPECTION" && !state.verifiedCustomerId) {
    return { ok: false, reason: "Customer is not verified." };
  }

  if (to === "RETENTION" && !state.subscriptionInspected) {
    return { ok: false, reason: "Subscription has not been inspected." };
  }

  if (to === "CONFIRMATION") {
    if (!state.retentionOffered) {
      return { ok: false, reason: "Retention has not been offered." };
    }
    // The OFFER having been made is not the same as the customer having
    // considered it. Presenting a discount and a cancellation prompt in
    // one breath satisfies the rule and defeats its purpose.
    if (!state.retentionDeclined) {
      return { ok: false, reason: "Customer has not declined the retention offer." };
    }
  }

  if (to === "EXECUTION") {
    if (!state.verifiedCustomerId) {
      return { ok: false, reason: "Customer is not verified." };
    }
    if (!state.confirmedAction) {
      return { ok: false, reason: "No confirmed action." };
    }
    // The confirmation must be for THIS customer — not some earlier one.
    if (state.confirmedAction.customerId !== state.verifiedCustomerId) {
      return {
        ok: false,
        reason: "Confirmation is for a different customer than the verified one.",
      };
    }
  }

  // 3. COMPLETE means the work is DONE, not that we reached the last stage.
  if (to === "COMPLETE" && !state.executedAction) {
    return { ok: false, reason: "Nothing was executed — cannot report completion." };
  }

  return { ok: true };
}

/**
 * The forward options from a stage, in preference order. Excludes the
 * escape hatches deliberately — ESCALATED has no preconditions, so an
 * automatic advance that considered it would escalate every conversation
 * immediately. Exits are taken on purpose, never by drift.
 */
export function nextStages(stage: Stage): Stage[] {
  return FORWARD_MOVES[stage];
}

/** Which tools to send to the model right now. */
export function toolsForStage(stage: Stage): string[] {
  return STAGE_TOOLS[stage];
}
