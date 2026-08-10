// One conversation. Used by both the scripted scenarios (agent.ts) and
// the interactive REPL (chat.ts), so the logic exists once.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { checkConfirmation, checkEscalationRequest, isBareAffirmative } from "./confirmation.js";
import { recordCall } from "./cost.js";
import { scanInput, type Flag } from "./guards.js";
import { runTool, TOOL_SPECS, type ToolContext, type World } from "./executor.js";
import type { Policy } from "./policy.js";
import { parseDateOfBirth, resolveAmbiguity, describe as describeDate } from "./dates.js";
import { AGENT_MODEL } from "./models.js";
import { canTransition, nextStages, restart, STAGE_TOOLS, type Stage, type TaskState } from "./workflow.js";

const client = new Anthropic();
const MODEL = AGENT_MODEL;

export const freshWorld = (): World => ({
  customers: [
    { id: "CUST-1029", email: "billy@example.com", name: "Billy Kinchin", dob: "1979-04-02" },
    { id: "CUST-2044", email: "sam@example.com", name: "Sam Okafor", dob: "1988-11-17" },
  ],
  subscriptions: [
    { customerId: "CUST-1029", plan: "PRO", priceGbp: 49, status: "active" },
    { customerId: "CUST-2044", plan: "BASIC", priceGbp: 12, status: "active" },
  ],
});

/** Tool descriptions for the current stage. Presentation only. */
function toolsFor(stage: Stage, state: TaskState): Anthropic.Tool[] {
  // An unreadable date of birth REMOVES verify_identity. The model
  // cannot be persuaded past a tool it does not have — which is the
  // whole reason this is here and not in the prompt. It asked twice,
  // was pushed a third time, and guessed.
  const allowed = STAGE_TOOLS[stage].filter(
    (t) => !(t === "verify_identity" && state.ambiguousDob),
  );
  return TOOL_SPECS.filter((t) => allowed.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema) as Anthropic.Tool["input_schema"],
  }));
}

/** Stage changes happen here. The model has no say. */
function advance(stage: Stage, state: TaskState): Stage {
  // Try each forward option in order. RETENTION branches — decline leads to
  // CONFIRMATION, accepting leads straight to COMPLETE — so a single "next"
  // stage per stage is no longer enough.
  for (const to of nextStages(stage)) {
    if (canTransition(stage, to, state).ok) return to;
  }
  return stage;
}

/**
 * The tools array tells the model what it CAN do. This tells it what the
 * PROCESS is. Without it the model sees a one-tool stage, concludes it can
 * never do the job, and invents a colleague to hand off to — then has to
 * retract when the next stage unlocks the tool.
 *
 * Describing the flow costs nothing in security: capability is still
 * enforced by the tools array. This only shapes what the agent SAYS.
 */
export function systemPromptFor(stage: Stage, state: TaskState = { subscriptionInspected: false }): string {
  return [
    "You are a subscription support agent.",
    "",
    "You are ONE agent working through a fixed process. You are NOT handing",
    "off to colleagues. Different tools become available to you as the",
    "process advances:",
    "",
    // KEEP IN STEP WITH workflow.ts. This is a document the model reads on
    // every call — when it goes stale it goes stale into production, and
    // no test catches it. RETENTION was missing here for a day after the
    // stage was added.
    "  GREETING      understand what they want",
    "  VERIFICATION  confirm the customer's identity",
    "  INSPECTION    look up the subscription",
    "  RETENTION     present the retention offer and get a decision on it",
    "  CONFIRMATION  state the action plainly and get a clear yes or no",
    "  EXECUTION     carry out the cancellation yourself",
    "  COMPLETE      done",
    "",
    `You are currently at: ${stage}.`,
    "",
    "Never say you will 'pass this to a colleague' or 'hand you over' for a",
    "step you will be able to do yourself later in the process. If a tool",
    "isn't available yet, say what has to happen first — e.g. 'once you",
    "confirm, I'll cancel it.' The only genuine handoff is escalate_to_human.",
    "",
    "Use only the tools available to you. Never claim to have done something",
    "you have no tool for. It is fine to say you don't know something.",
    // Capability removal is the control; this is the courtesy of saying
    // why. Without it the agent sees a stage with a missing tool and
    // invents an explanation — the same failure that produced the
    // imaginary colleague on day 5.
    state.ambiguousDob
      ? `\nThe date of birth they gave ("${state.ambiguousDob.raw}") could be ` +
        `${describeDate(state.ambiguousDob.readings[0])} or ` +
        `${describeDate(state.ambiguousDob.readings[1])}. You CANNOT verify\n` +
        "anyone until they say which. Ask them plainly, and do not guess or\n" +
        "try one and see — a date of birth is a security check, not a hint."
      : "",
    stage === "RETENTION"
      ? "\nPresent the retention offer and ASK whether they want it. Do not ask\n" +
        "about cancelling in the same message — one decision at a time. If they\n" +
        "accept, use apply_retention. If they decline, say you'll proceed to\n" +
        "cancellation and stop there."
      : "",
    stage === "CONFIRMATION"
      ? "\nThis is an IRREVERSIBLE action. State exactly what will happen, then\n" +
        "ask for a clear yes or no — e.g. 'Reply YES to cancel, or NO to keep\n" +
        "your subscription.' Do not bury the question or offer a third option."
      : "",
  ].join("\n");
}

export interface TurnResult {
  stage: Stage;
  text: string;
  /** Everything that happened, for printing. */
  events: string[];
}

export class Conversation {
  stage: Stage = "GREETING";
  ctx: ToolContext;
  private messages: Anthropic.MessageParam[] = [];
  private pending?: { tool: string; customerId: string };
  /** How many times they have asked for a person. Second ask is unconditional. */
  private humanRequests = 0;
  /** Anything the input guard noticed, with PII already removed. */
  readonly flagged: { flags: Flag[]; redacted: string }[] = [];

  constructor(policy: Policy, world: World = freshWorld()) {
    this.ctx = { policy, state: { subscriptionInspected: false }, world };
  }

  /**
   * Did this turn turn the retention offer down?
   *
   * Called TWICE per turn — before the model runs and after the tool
   * loop — because the offer itself may be made in the middle.
   *
   * Found by running the suite on Haiku. Four cases failed identically
   * (offer_retention ran, flow stalled at RETENTION), at roughly 1 in 3.
   * It is not a Haiku bug: the check was gated on the stage as it was at
   * the START of the turn, so a customer who declined in the same turn
   * the offer was made had their decline dropped on the floor. Opus
   * front-loads its tool calls, so the offer usually landed a turn
   * earlier and the timing happened to work.
   *
   * Same family as the day-6 bug where advance() ran after the model
   * call: state that changes mid-turn, read once at the wrong moment.
   *
   * Idempotent — the guard call is skipped once the decline is recorded,
   * so the second check costs nothing on the common path.
   */
  /**
   * Move the stage on, and do everything a stage change implies.
   *
   * This existed inline in THREE places and only two of them set
   * `pending` — so whichever transition reached CONFIRMATION decided
   * whether the next turn's confirmation check would run at all. It
   * worked only because the two complete copies happened to be the ones
   * that fired.
   *
   * Found by fixing the retention-decline ordering: that made the third
   * (incomplete) site the one reaching CONFIRMATION, and the failures
   * moved from "stuck at RETENTION" to "stuck at CONFIRMATION" — the
   * same bug one stage later. Copy-paste state machines drift, and they
   * drift silently.
   */
  private advanceStage(events: string[]): void {
    const before = this.stage;
    this.stage = advance(this.stage, this.ctx.state);
    if (this.stage === before) return;

    events.push(`[code] ${before} → ${this.stage}`);
    if (this.stage === "CONFIRMATION" && this.ctx.state.verifiedCustomerId) {
      this.pending = {
        tool: "cancel_subscription",
        customerId: this.ctx.state.verifiedCustomerId,
      };
    }
  }

  private async checkRetentionDecline(turn: string, events: string[]): Promise<void> {
    if (this.stage !== "RETENTION") return;
    if (!this.ctx.state.retentionOffered) return;
    if (this.ctx.state.retentionDeclined) return;

    const check = await checkConfirmation(
      "Turn down the retention offer and go ahead with cancelling the subscription.",
      turn,
    );
    if (check.affirms) {
      this.ctx.state.retentionDeclined = true;
      events.push(`[code] retention offer declined — "${check.quote}"`);
    }
  }

  async send(turn: string): Promise<TurnResult> {
    const events: string[] = [];

    // Input guard. Detection and redaction only — never blocking.
    //
    // The model still receives the ORIGINAL text: it needs the card number
    // to say "I can't take card details here", and redacting it would make
    // the agent incoherent. What we control is what reaches durable
    // storage. You cannot keep PII out of a context window; you can keep
    // it out of a database.
    const scan = scanInput(turn);
    if (scan.flags.length > 0) {
      this.flagged.push({ flags: scan.flags, redacted: scan.redacted });
      events.push(`[guard] ${scan.flags.join(", ")} — logged as: ${scan.redacted}`);
    }

    // Escape hatch 1 — a request for a human.
    //
    // Detected by a classifier, not a regex. The regex scored 6/16 on
    // realistic phrasings: it missed "put me through to someone" and
    // "get me your supervisor", and fired on "are you a human?".
    //
    // Tone decides the response, and the RULE lives here rather than in
    // the model's judgement — otherwise it varies run to run:
    //
    //   frustrated            → straight through. No offer, no model call.
    //   neutral, first ask    → the agent may offer to help once.
    //   neutral, asked again  → straight through. Nobody asks three times.
    //
    // The last line is the safeguard. Left to itself the model will keep
    // offering to help a politely persistent customer.
    // A bare "yes" is an ANSWER to whatever was just asked, never a
    // request for a person — so code answers that question before the
    // classifier is allowed to guess at it. Measured at 3/12 on ordinary
    // confirmations before this guard; the second bare "yes" in a
    // conversation escalated the customer mid-cancellation.
    if (this.stage !== "ESCALATED" && !isBareAffirmative(turn)) {
      const esc = await checkEscalationRequest(turn);
      if (esc.wantsHuman) {
        this.humanRequests++;
        const immediate = esc.tone === "frustrated" || this.humanRequests > 1;

        if (immediate) {
          this.stage = "ESCALATED";
          this.ctx.state.escalated = { reason: "customer_request", summary: turn };
          events.push(
            `[code] → ESCALATED (${esc.tone}, ask #${this.humanRequests}) — "${esc.quote}"`,
          );
          return {
            stage: this.stage,
            text: "Of course — passing you to a colleague now.",
            events,
          };
        }
        events.push(`[code] human requested (${esc.tone}, ask #1) — offering to help once`);
      }
    }

    // Read any date in this turn BEFORE the model gets a say. The model
    // proposes, code disposes — and a verification credential is the
    // last place that rule should have been left unenforced.
    const pending = this.ctx.state.ambiguousDob;
    if (pending) {
      // They were asked "April or February?". A bare month name is the
      // natural answer and parses as no date at all, so this has to be
      // asked as its own narrow question — found by reading a real
      // transcript, after both eval cases passed over it.
      const resolved = resolveAmbiguity(turn, pending.readings);
      if (resolved) {
        this.ctx.state.ambiguousDob = undefined;
        events.push(`[code] resolved to ${resolved} — verify_identity restored`);
      }
    }

    const dob = parseDateOfBirth(turn);
    if (dob.kind === "ambiguous") {
      this.ctx.state.ambiguousDob = { raw: dob.raw, readings: dob.readings };
      events.push(
        `[code] "${dob.raw}" is ambiguous (${dob.readings.join(" or ")}) — ` +
          "verify_identity withheld",
      );
    } else if (dob.kind === "iso" && this.ctx.state.ambiguousDob) {
      this.ctx.state.ambiguousDob = undefined;
      events.push(`[code] date resolved to ${dob.iso} — verify_identity restored`);
    }

    // Escape hatch 2 — wrong account. Go back, discard the evidence.
    if (/\b(wrong|different|not my) (account|email|address)\b/i.test(turn)) {
      this.ctx.state = restart();
      this.pending = undefined;
      this.stage = "GREETING";
      events.push("[code] state cleared → GREETING (verification discarded)");
    }

    // Did they turn the offer down? Same pattern as confirmation: a narrow
    // question, answered in isolation, recorded by code. "Offered" and
    // "declined" are different facts and only the second unlocks cancelling.
    await this.checkRetentionDecline(turn, events);

    // Confirmation. The model answers one narrow question in isolation;
    // YOUR CODE decides what to do with the answer and records it.
    if (this.stage === "CONFIRMATION" && this.pending) {
      const action = `Cancel the subscription for customer ${this.pending.customerId}. This is irreversible.`;
      const check = await checkConfirmation(action, turn);
      if (check.affirms) {
        this.ctx.state.confirmedAction = this.pending;
        events.push(`[code] confirmation recorded for ${this.pending.customerId} — "${check.quote}"`);
      } else {
        events.push(`[code] not treated as confirmation`);
      }
    }

    // ★ Advance BEFORE calling the model. The confirmation we just recorded
    //   may have unlocked the next stage, and the model must be given that
    //   stage's tools on THIS turn — not the next one. Otherwise it decides
    //   with a stale tool set and reasonably concludes it cannot help.
    this.advanceStage(events);

    this.messages.push({ role: "user", content: turn });

    let text = "";
    for (let step = 0; step < 6; step++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPromptFor(this.stage, this.ctx.state),
        tools: toolsFor(this.stage, this.ctx.state),
        messages: this.messages,
      });
      recordCall(MODEL, "agent", `turn@${this.stage}`, response.usage);
      this.messages.push({ role: "assistant", content: response.content });

      const uses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (uses.length === 0) {
        text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        break;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        // The only way to run a tool: schema → policy → execute → audit.
        const out = runTool(u.name, u.input, this.ctx);
        events.push(`→ ${u.name}(${JSON.stringify(u.input)})`);
        events.push(`← ${out}`);
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      this.messages.push({ role: "user", content: results });

      if (this.ctx.state.escalated && this.stage !== "ESCALATED") {
        this.stage = "ESCALATED";
        events.push(`[code] → ESCALATED (${this.ctx.state.escalated.reason})`);
        break;
      }

      this.advanceStage(events);
    }

    // ★ Check the decline AGAIN. The offer may have been made during the
    //   tool loop above, in which case the check at the top of this turn
    //   ran while the stage was still INSPECTION and skipped itself —
    //   silently dropping a decline the customer had already given.
    await this.checkRetentionDecline(turn, events);

    this.advanceStage(events);

    return { stage: this.stage, text, events };
  }
}
