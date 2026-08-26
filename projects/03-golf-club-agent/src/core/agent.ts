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
import {
  bookTeeTime,
  cancelBooking,
  checkAvailability,
  listBookings,
  type BookOutcome,
} from "../tools/tee-sheet.js";
import { MemoryStore, isAffirmative, statedAsStanding, type Memory } from "../memory/store.js";
import { ask, MODEL, type Answer } from "./answer.js";
import { loadDocuments, loadStructured } from "./corpus.js";

const client = new Anthropic();

// Loaded once. The corpus does not change mid-conversation, and re-reading
// seven files per turn is work with no purchaser.
const docs = loadDocuments();
const structured = loadStructured();

/**
 * WRITE POLICY: EXPLICIT ONLY.
 *
 * Day 11 lists four policies. This is the first one — nothing is stored
 * unless the member asks for it in so many words.
 *
 * It has the lowest recall of the four and it is still the right start.
 * End-of-session extraction produces a store full of things somebody
 * said once in irritation, and every one of those becomes an unverified
 * assertion injected into all their future conversations. Precision
 * matters more than recall here because the cost is asymmetric: a
 * missed preference is a small inconvenience the member can restate,
 * and a wrong one is the agent confidently acting on a belief the
 * member never held and cannot see.
 *
 * It is also the only policy with ZERO SURPRISE, which is most of what
 * separates a memory that feels useful from one that feels creepy.
 */
export const memory = new MemoryStore();

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
  /**
   * Slots the tee sheet has offered THIS SESSION.
   *
   * THE MODEL MAY NOT INVENT A SLOT ID. Every valid one came back from
   * a check_availability call minutes ago, so a booking request naming
   * anything else is either a transcription slip or a slot the model
   * reasoned "should" be free. Both produce a member booked onto
   * something they did not choose.
   *
   * The PRD's rule — confirm from the record, never from the agent's
   * message — makes that error RECOVERABLE, because the member reads
   * the true time. This makes most of it IMPOSSIBLE, which is better.
   * Detection is what you build when prevention is unavailable.
   */
  offered: Map<string, { date: string; time: string }>;
  /**
   * Loaded once, at the start of the session, not per turn.
   *
   * A memory that changes mid-conversation because the member just
   * created it would have the agent reacting to its own writes.
   * Refreshed explicitly when the member changes something.
   */
  memories: Memory[];
  /**
   * A memory the agent offered to store, waiting on a yes.
   *
   * HELD IN CODE, NOT IN THE MODEL'S HEAD. The first version let a
   * bare affirmative unlock any write, on the reasoning that the model
   * would only ask immediately before storing. It did not: asked "will
   * 9:30 work, or would you prefer 9:10?", the member said "yes
   * please", and the model spent that yes on a preference quoted from
   * a turn earlier. The member agreed to a tee time and got a memory.
   *
   * So the draft lives here. An affirmative commits THIS, or nothing —
   * the model cannot substitute what it would rather store, and a yes
   * meant for something else has nothing to unlock unless we actually
   * asked.
   *
   * It survives exactly one turn. A proposal the member walked past is
   * not consent they gave later.
   */
  pendingMemory?: { key: string; value: string; quote: string };
  /** This turn's view of pendingMemory, snapshotted at the top of turn(). */
  consumable?: { key: string; value: string; quote: string };
}

export const newSession = (memberId: string): Session => ({
  memberId,
  sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  step: 0,
  history: [],
  offered: new Map(),
  memories: memory.recall(memberId),
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
  /**
   * A write, reported FROM THE RECORD.
   *
   * The whole PRD rests on this: an agent's characteristic failure is
   * telling the member "Saturday 9am" while writing Sunday to the
   * sheet. If the confirmation is composed by the agent it repeats
   * "Saturday", the member is satisfied, and the error stays invisible
   * until they turn up. Generated from the record, the club's existing
   * error-detection loop keeps working.
   */
  | { kind: "booking"; outcome: BookOutcome }
  | { kind: "cancelled"; ok: boolean }
  | { kind: "memories"; memories: Memory[] }
  | { kind: "bookings"; bookings: { id: string; slotId: string; guests: number }[] }
  | { kind: "verbatim"; answer: Answer; badCitations: { source: string; why: string }[]; staleSources: { id: string; reviewDue: string }[] }
  | { kind: "error"; text: string }
  /**
   * Developer-only. Never reaches a member — memberText returns null.
   *
   * Added because a booking conversation went wrong and the transcript
   * could not say why: check_availability produced no visible output,
   * so "there are no free tee times" was indistinguishable from "the
   * tee sheet errored and the model narrated the error as an empty
   * result". A tool whose result you cannot inspect is a tool you
   * cannot debug, and the second reading turned out to be the true one.
   */
  | { kind: "trace"; tool: string; args: unknown; note: string };

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
const TERMINAL = new Set([
  "search_knowledge",
  "end_turn",
  // Memory is shown from the store, not described by the model.
  "show_what_you_know",
  // WRITES ARE REPORTED BY CODE, NOT NARRATED BY THE MODEL.
  //
  // `check_availability` is deliberately NOT here: availability is
  // transient, and a garbled time is caught seconds later when the
  // booking fails. A garbled BOOKING is caught on Saturday, at the
  // club, in front of other members. That asymmetry is the whole
  // reason for the line.
  //
  // list_my_bookings is on the list for the same reason — it states a
  // booking's details, and a member told the wrong time misses a round
  // whether the sentence came from a write or a read.
  "book_tee_time",
  "cancel_booking",
  "list_my_bookings",
]);

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
    name: "check_availability",
    description:
      "Free tee times on a date. Returns real slot IDs from the tee sheet. " +
      "Call this before any booking — you cannot book a slot you have not been shown.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        from: { type: "string", description: "Earliest time, HH:MM. Default 00:00." },
        to: { type: "string", description: "Latest time, HH:MM. Default 23:59." },
      },
      required: ["date"],
    },
  },
  {
    name: "list_my_bookings",
    // NO memberId PARAMETER. See the note in execute().
    description:
      "The member's current bookings. Shown to the member directly from the tee sheet — " +
      "do not restate the times afterwards.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "book_tee_time",
    description:
      "Book a tee time. The slot ID must be one check_availability gave you in this " +
      "conversation. Confirmation goes to the member directly from the tee-sheet record — " +
      "do not tell them the date or time yourself, and do not say the booking is made " +
      "before calling this.",
    input_schema: {
      type: "object",
      properties: {
        slotId: { type: "string", description: "Exactly as returned by check_availability." },
        partySize: { type: "number", description: "Total players including the member." },
        guests: { type: "number", description: "How many of the party are guests." },
      },
      required: ["slotId", "partySize", "guests"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel one of the member's bookings. Get the ID from list_my_bookings. " +
      "Cancelling within 24 hours of the tee time incurs a fee — if the member has not " +
      "already been told that, ask search_knowledge before cancelling, not after.",
    input_schema: {
      type: "object",
      properties: { bookingId: { type: "string" } },
      required: ["bookingId"],
    },
  },
  {
    name: "remember_preference",
    description:
      "Store a preference the member has EXPLICITLY asked you to remember — " +
      "\"remember that I...\", \"I always...\", \"from now on...\". " +
      "Never call this because a preference seemed implied by what they booked. " +
      "Preferences only: how they like to be contacted, what times they like to play, " +
      "how they usually play. Never anything about their health, their finances, their " +
      "family, or another person.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description:
            "A stable snake_case name for the KIND of preference, so a later statement " +
            "replaces this one: preferred_tee_time, contact_method, group_size, buggy.",
        },
        value: { type: "string", description: "One short phrase. 'before 09:00'." },
        quote: {
          type: "string",
          description: "The member's own words, verbatim. Required — this is what we show them.",
        },
      },
      required: ["key", "value", "quote"],
    },
  },
  {
    name: "show_what_you_know",
    description:
      "Everything remembered about this member, shown to them directly with dates and " +
      "their own words. Use for \"what do you know about me?\". Do not summarise it after.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_what_you_know",
    description:
      "Correct or delete one remembered preference. Use the key from show_what_you_know.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: {
          type: "string",
          description: "The corrected value, or the exact word FORGET to delete it.",
        },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "forget_everything",
    description:
      "Delete everything remembered about this member. Only when they clearly ask for all " +
      "of it to go. Irreversible.",
    input_schema: { type: "object", properties: {} },
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

/**
 * THE MODEL DOES NOT KNOW WHAT DAY IT IS.
 *
 * Asked for "Saturday the 29th of August" it called the tee sheet for
 * 2025-08-29 — last year, and a Friday. The sheet answered truthfully
 * about a date nobody asked about, and the model reported "no free
 * slots Saturday morning, 29 August", confirming the member's own word
 * back to them while having checked a different day.
 *
 * Nothing had ever told it the date. A model's sense of "today" is its
 * training cutoff, which is neither today nor stable, so every agent
 * doing date arithmetic needs this and most do not have it.
 *
 * Built fresh per turn rather than at module load: a process that stays
 * up overnight would otherwise serve yesterday's date to tomorrow's
 * members, which is the same bug with a slower fuse.
 */
const systemPrompt = (s: Session): string => {
  const today = new Date();
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-AU", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
      timeZone: "Australia/Sydney",
    });
  const iso = today.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  return `Today is ${fmt(today)}. In ISO form that is ${iso}.

The club is in Sydney. When a member names a day without a year they mean the
NEXT one — never a past date. Members can book up to six weeks ahead.

You are the member services agent for a golf club.

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

Be warm and short. Members are usually on a phone.
${recalled(s)}`;
};

/**
 * Memory, framed as fallible — which is the whole point of the format.
 *
 * Presented as fact, a model acts on a stale belief with the same
 * confidence it acts on a tool result. The dates and the caveat are not
 * decoration; they measurably change what it does with a preference
 * from eleven months ago, and they are what lets it say "you mentioned
 * in March that..." rather than asserting it.
 *
 * Budgeted at 8 by the store's own default. An unbounded injection is
 * an unbounded prompt, and the memories least worth having are the ones
 * that would be added last.
 */
function recalled(s: Session): string {
  if (s.memories.length === 0) return "";
  const lines = s.memories.map((m) => {
    const when = new Date(m.lastConfirmedAt).toLocaleDateString("en-AU", {
      day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Sydney",
    });
    return `- ${m.value} (they told us on ${when})`;
  });
  return `
What you know about this member from previous conversations. It MAY BE OUT OF
DATE and none of it has been verified — check anything that matters before
acting on it, and never state it as fact:
${lines.join("\n")}`;
}

const weekday = (isoDate: string): string => {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "long", timeZone: "UTC",
  });
};

/** Why this date cannot be booked, or undefined. Pure — testable with no model. */
export function dateProblem(isoDate: string, now = new Date()): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return `"${isoDate}" is not a date.`;
  const today = now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
  if (isoDate < today) return `${isoDate} is in the past (today is ${today}).`;
  const [y, m, d] = isoDate.split("-").map(Number);
  const limit = new Date(now.getTime() + 42 * 864e5).toLocaleDateString("en-CA", {
    timeZone: "Australia/Sydney",
  });
  if (isoDate > limit) return `${isoDate} is more than six weeks ahead (the limit is ${limit}).`;
  void y; void m; void d;
  return undefined;
}

/**
 * The member's own words this turn, ignoring tool results.
 *
 * history holds tool_result blocks under role "user" as well, so the
 * last entry is usually not a person speaking.
 */
function lastMemberTurn(s: Session): string {
  for (let i = s.history.length - 1; i >= 0; i--) {
    const m = s.history[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/** "2026-08-23T09:20" → { date, time }. The tee sheet's slot IDs are self-describing. */
const slotParts = (slotId: string) => {
  const [date, time] = slotId.split("T");
  return { date: date ?? slotId, time: time ?? "" };
};

/** One member turn. Returns everything the member should see, in order. */
export async function turn(s: Session, input: string): Promise<Reply[]> {
  // Snapshot and clear: a proposal is answerable for one turn only.
  s.consumable = s.pendingMemory;
  s.pendingMemory = undefined;

  s.history.push({ role: "user", content: input });
  const out: Reply[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt(s),
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
      out.push({ kind: "trace", tool: call.name, args: call.input, note: forModel });
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

  if (name === "check_availability") {
    const { date, from, to } = input as { date: string; from?: string; to?: string };

    // THE BUSINESS RULE IS ALSO THE SANITY CHECK.
    //
    // "Six weeks ahead, never the past" comes from booking-rules.yaml,
    // and enforcing it in code catches the model's wrong-year guess
    // before it becomes a truthful answer about the wrong day. A rule
    // worth having is usually worth having as a guard.
    const problem = dateProblem(date);
    if (problem) return { forModel: `Refused: ${problem} Ask the member which date they mean.` };

    try {
      const { slots } = await checkAvailability(date, from ?? "00:00", to ?? "23:59");
      // EVERY OFFERED SLOT GOES IN THE LEDGER, including the ones the
      // model chooses not to mention. If the tee sheet offered it, the
      // member may name it.
      for (const sl of slots) s.offered.set(sl.slotId, { date: sl.date, time: sl.time });
      return {
        // The WEEKDAY goes back too. If the member said Saturday and
        // this says Friday, the model can see the mismatch — it could
        // not before, because a bare ISO date carries no day name.
        forModel:
          slots.length === 0
            ? `No free slots on ${weekday(date)} ${date} in that window.`
            : `Free slots on ${weekday(date)} ${date}: ` +
              slots.map((x) => `${x.time} (${x.slotId})`).join(", "),
      };
    } catch (e) {
      return { forModel: `The tee sheet is unavailable: ${(e as Error).message}. Do not guess.` };
    }
  }

  if (name === "list_my_bookings") {
    try {
      const { bookings } = await listBookings(s.memberId);
      // Offered, therefore cancellable and re-bookable.
      for (const b of bookings) s.offered.set(b.slotId, slotParts(b.slotId));
      return {
        reply: { kind: "bookings", bookings },
        // IDs INCLUDED, DELIBERATELY.
        //
        // The first version withheld them — "shown to the member, do
        // not restate" — and the model then tried to cancel using a
        // slot ID, because it had never been told a booking ID exists.
        // Terminal means the model does not WRITE the member's
        // sentence; it does not mean starving it of the handles it
        // needs to act. Withholding those protected nothing.
        forModel:
          bookings.length === 0
            ? `The member has no bookings. They have been told.`
            : `Shown to the member from the record. Do not restate the times. ` +
              `For your own use when cancelling: ` +
              bookings.map((b) => `${b.id} = ${b.slotId}`).join(", "),
      };
    } catch (e) {
      return {
        reply: { kind: "error", text: (e as Error).message },
        forModel: `The tee sheet is unavailable. Do not guess what they have booked.`,
      };
    }
  }

  if (name === "book_tee_time") {
    const { slotId, partySize, guests } = input as {
      slotId: string;
      partySize: number;
      guests: number;
    };

    // THE LEDGER CHECK. A prompt asking the model to only book slots it
    // was shown is a request; this is a guarantee. It stops both a
    // transcription slip and a slot the model reasoned "should" be free.
    if (!s.offered.has(slotId)) {
      return {
        forModel:
          `Refused: ${slotId} is not a slot the tee sheet offered in this conversation. ` +
          `Call check_availability and book one of the slot IDs it returns.`,
      };
    }

    try {
      const outcome = await bookTeeTime({
        slotId,
        memberId: s.memberId,
        partySize,
        guests,
        sessionId: s.sessionId,
        step: s.step,
      });
      // Alternatives are offers too — a member may take one next turn.
      if (outcome.status === "slot_taken") {
        for (const a of outcome.alternatives) s.offered.set(a.slotId, slotParts(a.slotId));
      }
      return {
        reply: { kind: "booking", outcome },
        forModel:
          outcome.status === "booked"
            ? `Booked. The member has been shown the confirmation from the tee-sheet record. ` +
              `Do not repeat the date, time or reference.`
            : `Not booked (${outcome.status}). The member has been told. Do not invent a fix.`,
      };
    } catch (e) {
      return {
        reply: { kind: "error", text: (e as Error).message },
        forModel: `The booking failed and it is NOT known whether it landed. Do not retry.`,
      };
    }
  }

  if (name === "cancel_booking") {
    const { bookingId } = input as { bookingId: string };
    try {
      const r = await cancelBooking({
        bookingId,
        memberId: s.memberId,
        sessionId: s.sessionId,
        step: s.step,
      });
      return {
        reply: { kind: "cancelled", ok: r.cancelled },
        forModel: `Cancellation reported to the member from the record.`,
      };
    } catch (e) {
      return {
        reply: { kind: "error", text: (e as Error).message },
        forModel: `The cancellation failed and may or may not have landed. Do not retry.`,
      };
    }
  }

  if (name === "remember_preference") {
    const { key, value, quote } = input as { key: string; value: string; quote: string };

    // THE WRITE POLICY, ENFORCED IN CODE.
    //
    // Checked against what the MEMBER said this turn, never against the
    // quote the model supplied — the model chooses that quote, so
    // checking it would be marking its own homework.
    const turnText = lastMemberTurn(s);

    // A yes commits the draft WE held, not the one the model sent now.
    const consenting = isAffirmative(turnText) && s.consumable;
    const draft = consenting ? s.consumable! : { key, value, quote };

    if (!consenting && !statedAsStanding(turnText)) {
      // Not a refusal — an offer. The member described a habit; if it
      // is worth keeping, they can say so.
      s.pendingMemory = { key, value, quote };
      return {
        forModel:
          `Not stored — the member described a habit rather than asking you to remember it. ` +
          `Ask them, in a short sentence and ABOUT NOTHING ELSE, whether you should make a ` +
          `note of it. If they say yes, call this tool again.`,
      };
    }
    const r = memory.remember(s.memberId, {
      type: "preference",
      key: draft.key,
      value: draft.value,
      // Explicit statements are the only ones stored, so confidence is
      // high by construction. It is not 1.0 because the model still
      // paraphrased the member into a key and a value, and that step
      // can be wrong even when the member was clear.
      confidence: 0.95,
      source: { sessionId: s.sessionId, turnIndex: s.history.length, quote: draft.quote },
    });

    if ("refused" in r) {
      // NOT AN ERROR, and not something to apologise for. The member
      // said something they are entitled to say; we simply do not keep
      // it. Telling them plainly is better than silently not storing
      // it and letting them believe we did.
      return {
        reply: {
          kind: "text",
          text:
            `I'll help with that now, but I won't write it down — it touches on something ` +
            `personal and we don't keep records of that sort of thing.`,
        },
        forModel: `Refused (${r.refused}). Help them THIS TURN but do not retry storing it.`,
      };
    }

    s.consumable = undefined;
    s.memories = memory.recall(s.memberId);
    return { forModel: `Stored: ${draft.key} = ${draft.value}. Confirm briefly and naturally.` };
  }

  if (name === "show_what_you_know") {
    s.memories = memory.recall(s.memberId);
    return {
      reply: { kind: "memories", memories: s.memories },
      forModel:
        s.memories.length === 0
          ? `Nothing stored. The member has been told.`
          : `Shown to the member with dates and their own words. Do not restate it. ` +
            `Keys, for your own use: ${s.memories.map((m) => m.key).join(", ")}`,
    };
  }

  if (name === "update_what_you_know") {
    const { key, value } = input as { key: string; value: string };
    const target = memory.recall(s.memberId).find((m) => m.key === key);
    if (!target) return { forModel: `No memory with key "${key}". Call show_what_you_know.` };

    const gone = value.trim().toUpperCase() === "FORGET";
    const ok = gone
      ? memory.forget(s.memberId, target.id)
      : memory.correct(s.memberId, target.id, value);
    s.memories = memory.recall(s.memberId);

    if (!ok) {
      return {
        reply: { kind: "text", text: `I can't record that one, but I've noted what you said.` },
        forModel: `Refused. Do not retry.`,
      };
    }
    return {
      reply: { kind: "text", text: gone ? `Done — I've forgotten that.` : `Updated — thanks.` },
      forModel: gone ? `Deleted "${key}".` : `Corrected "${key}" to "${value}".`,
    };
  }

  if (name === "forget_everything") {
    const n = memory.forgetAll(s.memberId);
    s.memories = [];
    return {
      reply: {
        kind: "text",
        text:
          n === 0
            ? `There was nothing stored, so there's nothing to delete.`
            : `Done — ${n} thing${n === 1 ? "" : "s"} deleted. I don't know anything about you now.`,
      },
      forModel: `Erased ${n} memories. You now know nothing about this member.`,
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
