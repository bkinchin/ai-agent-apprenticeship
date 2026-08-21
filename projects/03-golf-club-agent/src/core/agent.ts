// The conversational loop: routing, not composing.
//
// Day 9 built a knowledge agent that returns CITED answers, with code —
// not the prompt — rejecting an "answered" that carries no citation.
// Day 10 built booking tools with idempotency and compensation. Neither
// had ever met the other: `ask` could answer but not book, and
// `book_tee_time` was reachable only from a test script.
//
// Wiring them together has one trap in it, and it is the same trap the
// PRD found on day 8.
//
// THE TRAP. The obvious design gives the model a `search_knowledge`
// tool, feeds the result back, and lets the model write the reply. That
// dissolves every day-9 guarantee, because the string the member reads
// is no longer the string that was verified — the model is free to
// paraphrase it, blend it with a fee it half-remembers from four turns
// ago, and the citation check never sees the final sentence.
//
// It is say/do divergence, one week later and in a different costume:
//
//   PRD §1  "The confirmation email must be generated from the
//            tee-sheet record, never from the agent's message."
//
// So this loop separates two jobs the naive design merges:
//
//   DECIDING WHAT TO DO    the model is good at this. It picks the tool.
//   COMPOSING WHAT IS READ  it does not have to do this, and for
//                           anything verified it must not.
//
// A knowledge answer is therefore TERMINAL: it goes to the member
// exactly as `ask()` produced it, citations attached, and the turn ends.
// The model routed. It did not write.
//
// WHAT THIS COSTS, stated plainly because there is no free abstraction:
// the reply reads like a document rather than like a conversation. There
// is no "as I mentioned earlier". A member who asks a question AND makes
// a booking request in one breath gets the question answered and the
// booking deferred to the next turn. That is a real cost in fluency,
// accepted deliberately, because a club telling members what things cost
// should be right more than it should be smooth.

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { ask, MODEL, type Answer } from "./answer.js";
import { loadDocuments, loadStructured } from "./corpus.js";

const client = new Anthropic();

// Loaded once. The corpus does not change mid-conversation, and re-reading
// seven files per turn is work with no purchaser.
const docs = loadDocuments();
const structured = loadStructured();

export interface Session {
  memberId: string;
  /** Idempotency scope. Per-process — see KNOWN GAP at the foot of this file. */
  sessionId: string;
  /**
   * MONOTONIC. Increments on every tool call and never resets.
   *
   * Day 10's reflection found the collision this prevents: book a slot,
   * cancel it, book the same slot again within one session, and a step
   * that has not advanced produces the same idempotency key — handing
   * back the CANCELLED booking's reference. The member is told they
   * hold a slot that no longer exists.
   */
  step: number;
  history: MessageParam[];
}

export const newSession = (memberId: string): Session => ({
  memberId,
  sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  step: 0,
  history: [],
});

/**
 * What the member sees.
 *
 * A list rather than a string because one turn can legitimately produce
 * more than one thing, and because the KIND matters downstream: a
 * `verbatim` reply has been checked against the corpus and a `text` one
 * has not. Collapsing them to a string throws away exactly the
 * distinction this design exists to preserve.
 */
export type Reply =
  | { kind: "text"; text: string }
  | { kind: "verbatim"; answer: Answer; badCitations: { source: string; why: string }[]; staleSources: { id: string; reviewDue: string }[] }
  | { kind: "error"; text: string };

/**
 * A ceiling on model calls per turn.
 *
 * Not a nicety. A loop that calls a model until the model decides to
 * stop is an unbounded spend controlled by a non-deterministic process,
 * and the failure mode is not a crash — it is a bill. Day 12 turns
 * hitting this into an escalation; for now it terminates honestly.
 */
const MAX_STEPS = 6;

/**
 * Tools that answer the member DIRECTLY.
 *
 * The result is not fed back for the model to rewrite. This set is the
 * mechanism, so it lives next to the loop rather than in a config file
 * three directories away.
 */
const TERMINAL = new Set(["search_knowledge", "end_turn"]);

const TOOLS: Tool[] = [
  {
    name: "search_knowledge",
    description:
      "Answer a question about the club's rules, fees, dress code, opening hours, " +
      "competitions, etiquette or procedures. The answer goes to the member DIRECTLY, " +
      "with its sources attached — you will not see it before they do, and you must not " +
      "try to summarise or repeat it afterwards. " +
      "Ask a COMPLETE, STANDALONE question: the knowledge base cannot see this " +
      "conversation, so resolve any references first. If the member said 'how much for a " +
      "guest?' and then 'what about two?', ask 'how much does it cost to bring two guests?'",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "A complete question, understandable with no other context.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "end_turn",
    // THE ESCAPE HATCH, AND WHY IT DOES NOT REOPEN THE HOLE.
    //
    // Forcing a tool call closed the "model answers from memory" hole
    // and immediately produced a worse conversation: a member said
    // "thanks, that's great" and — with only search_knowledge to reach
    // for — was told to ask the Club Secretary about the pet policy.
    //
    // The hole was never "the model produced text". It was "the model
    // produced UNVERIFIED CLAIMS ABOUT THE CLUB". A reply that cannot
    // carry a fact cannot carry a wrong one, so this is constrained to
    // pleasantries and checked in code for figures — the same guard
    // day 9 put on the abstention branch's `suggestion` field, one
    // layer up.
    //
    // The residual risk is real but small and VISIBLE: the model calls
    // this for a genuine question and the member gets "you're welcome"
    // instead of an answer. Annoying, obvious, and self-reporting —
    // which is the trade you want against a fabricated fee.
    description:
      "Reply to a turn that asks for nothing: a greeting, a thank-you, a goodbye, " +
      "or small talk. Your message must contain NO facts about the club — no prices, " +
      "times, dates, rules or availability. If the member asked for anything at all, " +
      "even in passing, use another tool instead.",
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "One warm sentence. No club facts.",
        },
      },
      required: ["message"],
    },
  },
];

const SYSTEM = `You are the member services agent for a golf club.

You route. You do not answer from your own knowledge.

You know nothing about this club that a tool has not told you. You have never
seen its fees, its dress code, its opening hours or its booking rules. If you
find yourself about to state a fact about the club, that is a tool call you
have not made yet.

Anything about rules, fees, hours, dress code, competitions or etiquette goes
to search_knowledge. It replies to the member itself, with sources — so do not
introduce it ("let me look that up"), do not summarise it afterwards, and do
not restate what you think it said. Call the tool; the turn ends there.

If a question is not about the club at all, say so briefly.

Be warm and short. Members are usually on a phone.`;

/** One member turn. Returns everything the member should see, in order. */
export async function turn(s: Session, input: string): Promise<Reply[]> {
  s.history.push({ role: "user", content: input });
  const out: Reply[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: TOOLS,
      // THE MODEL DOES NOT GET TO DECIDE WHETHER A QUESTION IS IN SCOPE.
      //
      // Asked "can I bring my dog?", it answered on its own authority —
      // "that's not about club rules, ring us" — without calling
      // anything. Dogs ARE a club-rules question; the corpus has no
      // policy, and the knowledge agent handles exactly that case with
      // an abstention, a named contact, and a check for figures
      // smuggled into the suggestion. All of it was bypassed.
      //
      // It was not WRONG that time. It demonstrated that it CAN be:
      // the mechanism that lets it decline without checking is the one
      // that will let it ANSWER without checking, on the day it feels
      // confident about a guest fee.
      //
      // The system prompt already forbade this. A prompt is a request.
      // So the first inference of every turn MUST call a tool, and the
      // in-scope judgement moves to the corpus — which is good at it,
      // and leaves a record either way.
      //
      // Cost: "thanks, that's great" now buys a knowledge lookup,
      // ~$0.009. At 20 interactions a day that is ~$20/year to close
      // the hole. Cheaper than one member acting on an invented rule.
      //
      // Only the FIRST inference. Later ones must be free to produce
      // text, or a non-terminal tool result could never be narrated.
      tool_choice: i === 0 ? { type: "any" } : { type: "auto" },
      messages: s.history,
    });

    s.history.push({ role: "assistant", content: response.content });

    // Any prose the model wrote alongside its tool calls. Usually empty,
    // and when it is not it is generally the model narrating itself
    // ("let me check that for you") — which the prompt discourages, but
    // a prompt is a request, so it is surfaced rather than assumed away.
    for (const block of response.content) {
      if (block.type === "text" && block.text.trim()) {
        out.push({ kind: "text", text: block.text.trim() });
      }
    }

    if (response.stop_reason !== "tool_use") return out;

    const calls = response.content.filter((b) => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = [];
    let terminated = false;

    for (const call of calls) {
      s.step++;
      const { reply, forModel } = await execute(s, call.name, call.input);
      if (reply) out.push(reply);
      results.push({ type: "tool_result", tool_use_id: call.id, content: forModel });
      if (TERMINAL.has(call.name)) terminated = true;
    }

    // THE TOOL RESULT IS RECORDED EVEN WHEN THE TURN ENDS HERE.
    //
    // Two reasons, and the first is not optional. The API requires every
    // tool_use block to be answered by a tool_result in the following
    // message; leaving one dangling makes the NEXT turn a 400, which
    // would show up as a mysterious crash one question later rather
    // than here. The second is that the model should know what the
    // member was told, so it can handle "and what about at weekends?"
    s.history.push({ role: "user", content: results });

    // Terminal tool: the member has their answer, from the verified
    // object rather than from the model. Stop before another inference.
    if (terminated) return out;
  }

  // Ran out of steps. Say so rather than returning silence — an agent
  // that stops without explanation is indistinguishable from one that
  // crashed, and the member cannot tell which.
  out.push({
    kind: "error",
    text: "I'm going round in circles on that one — best to ring the pro shop on the number above.",
  });
  return out;
}

/**
 * Run one tool.
 *
 * Returns what the MEMBER sees and, separately, what the MODEL sees.
 * They are different on purpose: the member gets the verified object,
 * the model gets a short note that the question was answered — enough
 * to follow the conversation, not enough to be tempted into repeating it.
 */
async function execute(
  s: Session,
  name: string,
  input: unknown,
): Promise<{ reply?: Reply; forModel: string }> {
  if (name === "search_knowledge") {
    const { question } = input as { question: string };
    const r = await ask(question, docs, structured);
    if (!r.answer) {
      return {
        reply: { kind: "error", text: "Something went wrong looking that up — try me again?" },
        forModel: "The knowledge base failed to answer. Do not guess.",
      };
    }
    return {
      reply: {
        kind: "verbatim",
        answer: r.answer,
        badCitations: r.badCitations,
        staleSources: r.staleSources,
      },
      // Deliberately terse. The model does not need the answer text and
      // giving it the text invites it to repeat a paraphrase next turn.
      forModel:
        r.answer.status === "answered"
          ? `Answered and shown to the member, with sources. Question: "${question}"`
          : `Could not answer from the knowledge base; the member was told who to ask.`,
    };
  }

  if (name === "end_turn") {
    const { message } = input as { message: string };
    // A pleasantry carrying a figure is a club fact that has walked
    // around the citation requirement. Surfaced, not suppressed — the
    // same treatment as a `suggestion` containing a number.
    return {
      reply: /\d/.test(message)
        ? { kind: "error", text: `${message}\n  ⚑ end_turn carried a figure — uncited` }
        : { kind: "text", text: message },
      forModel: "Turn closed.",
    };
  }

  return { forModel: `No such tool: ${name}` };
}

// ── KNOWN GAPS ──────────────────────────────────────────────────
//
// IDENTITY IS A STUB. `memberId` arrives from `/login` in the REPL and
// nothing verifies it. A real deployment authenticates the member before
// any tool sees their ID; until it does, this agent will happily read
// one member's bookings on another's say-so. Recorded here rather than
// as a TODO because it is a policy gap, not a coding one.
//
// SESSION IDENTITY IS NOT STABLE. `sessionId` lasts as long as the
// process. Reconnect, restart, or move to a different device and the
// idempotency key changes, which means it protects nothing across
// exactly the failures it was built for. Day 10 flagged this as the more
// likely of its two failure modes and it is still true. The fix is to
// derive the key from something the CONVERSATION owns — a request id
// minted when the member first states the intent — rather than from the
// transport.
