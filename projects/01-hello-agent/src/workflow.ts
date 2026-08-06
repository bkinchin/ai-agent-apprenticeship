// The state machine. Pure functions only — no API calls, no database,
// no console output. Everything here is testable in milliseconds.

export type Stage =
  | "GREETING"
  | "VERIFICATION"
  | "INSPECTION"
  | "CONFIRMATION"
  | "EXECUTION"
  | "COMPLETE";

/** Facts your CODE has established. Never things the model claimed. */
export interface TaskState {
  /** Set only after your code compared two values and they matched. */
  verifiedCustomerId?: string;
  /** Set only after get_subscription actually returned. */
  subscriptionInspected: boolean;
  /**
   * Set only from a user turn that arrived AFTER the agent described
   * this exact action. Records WHAT was confirmed, not just that
   * something was.
   */
  confirmedAction?: { tool: string; customerId: string };
}

/** Which tools exist in each stage. Anything not listed cannot be called. */
export const STAGE_TOOLS: Record<Stage, string[]> = {
  GREETING: ["find_customer"],
  VERIFICATION: ["find_customer", "verify_customer"],
  INSPECTION: ["get_subscription"],
  CONFIRMATION: [], // conversation only — nothing to call here
  EXECUTION: ["cancel_subscription"],
  COMPLETE: [],
};

/** The only moves that exist. Anything else is illegal by omission. */
const ALLOWED_MOVES: Record<Stage, Stage[]> = {
  GREETING: ["VERIFICATION"],
  VERIFICATION: ["INSPECTION"],
  INSPECTION: ["CONFIRMATION"],
  CONFIRMATION: ["EXECUTION"],
  EXECUTION: ["COMPLETE"],
  COMPLETE: [],
};

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

  if (to === "CONFIRMATION" && !state.subscriptionInspected) {
    return { ok: false, reason: "Subscription has not been inspected." };
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

  return { ok: true };
}

/** Which tools to send to the model right now. */
export function toolsForStage(stage: Stage): string[] {
  return STAGE_TOOLS[stage];
}
