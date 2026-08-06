// One conversation. Used by both the scripted scenarios (agent.ts) and
// the interactive REPL (chat.ts), so the logic exists once.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runTool, TOOL_SPECS, type ToolContext, type World } from "./executor.js";
import type { Policy } from "./policy.js";
import { canTransition, restart, STAGE_TOOLS, type Stage, type TaskState } from "./workflow.js";

const client = new Anthropic();
const MODEL = "claude-opus-5";

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
function toolsFor(stage: Stage): Anthropic.Tool[] {
  const allowed = STAGE_TOOLS[stage];
  return TOOL_SPECS.filter((t) => allowed.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema) as Anthropic.Tool["input_schema"],
  }));
}

/** Stage changes happen here. The model has no say. */
function advance(stage: Stage, state: TaskState): Stage {
  const next: Record<Stage, Stage | null> = {
    GREETING: "VERIFICATION",
    VERIFICATION: "INSPECTION",
    INSPECTION: "CONFIRMATION",
    CONFIRMATION: "EXECUTION",
    EXECUTION: "COMPLETE",
    COMPLETE: null,
    ESCALATED: null,
  };
  const to = next[stage];
  if (!to) return stage;
  return canTransition(stage, to, state).ok ? to : stage;
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

  constructor(policy: Policy, world: World = freshWorld()) {
    this.ctx = { policy, state: { subscriptionInspected: false }, world };
  }

  async send(turn: string): Promise<TurnResult> {
    const events: string[] = [];

    // Escape hatch 1 — a request for a human. Immediate, from any stage,
    // without calling the model at all.
    if (/\b(human|real person|speak to someone|manager)\b/i.test(turn)) {
      this.stage = "ESCALATED";
      events.push("[code] → ESCALATED (customer asked for a human)");
      return { stage: this.stage, text: "Of course — passing you to a colleague now.", events };
    }

    // Escape hatch 2 — wrong account. Go back, discard the evidence.
    if (/\b(wrong|different|not my) (account|email|address)\b/i.test(turn)) {
      this.ctx.state = restart();
      this.pending = undefined;
      this.stage = "GREETING";
      events.push("[code] state cleared → GREETING (verification discarded)");
    }

    // Confirmation is recorded by code, bound to the action on the table.
    if (
      this.stage === "CONFIRMATION" &&
      this.pending &&
      /^(yes|yeah|yep|confirm|do it|go ahead)/i.test(turn)
    ) {
      this.ctx.state.confirmedAction = this.pending;
      events.push(`[code] confirmation recorded for ${this.pending.customerId}`);
    }

    this.messages.push({ role: "user", content: turn });

    let text = "";
    for (let step = 0; step < 6; step++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system:
          `You are a subscription support agent. Current stage: ${this.stage}. ` +
          `Use only the tools available to you. Never claim to have done ` +
          `something you have no tool for.`,
        tools: toolsFor(this.stage),
        messages: this.messages,
      });
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

      const before = this.stage;
      this.stage = advance(this.stage, this.ctx.state);
      if (this.stage !== before) {
        events.push(`[code] ${before} → ${this.stage}`);
        if (this.stage === "CONFIRMATION" && this.ctx.state.verifiedCustomerId) {
          this.pending = {
            tool: "cancel_subscription",
            customerId: this.ctx.state.verifiedCustomerId,
          };
        }
      }
    }

    const before = this.stage;
    this.stage = advance(this.stage, this.ctx.state);
    if (this.stage !== before) events.push(`[code] ${before} → ${this.stage}`);

    return { stage: this.stage, text, events };
  }
}
