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

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { disabled, RateLimiter } from "./limits.js";
import { computeVersions } from "../observe/versions.js";
import { setVersions, span, trace } from "../observe/tracer.js";
import { buildHandoff, memberMessage, type Handoff } from "../escalation/handoff.js";
import { askedForAHuman, soundsFrustrated, vulnerability } from "../escalation/policy.js";
import { Actions, Queue, type PendingAction } from "../escalation/queue.js";
import {
  amendBooking,
  bookTeeTime,
  cancelBooking,
  checkAvailability,
  listBookings,
  type AmendOutcome,
  type BookOutcome,
} from "../tools/tee-sheet.js";
import {
  MemoryStore,
  excludedBy,
  isAffirmative,
  isNegative,
  mentionedCompany,
  saidTheyArePlayingAlone,
  statedAsStanding,
  type Memory,
} from "../memory/store.js";
import { checkBooking, reconcileLimit, rulesFrom } from "./rules.js";
import { closedFor, weekdayNamed, weekdayOf } from "./slots.js";
import { memberSentence, memoryOfferText } from "./render.js";
import { ask, MODEL, type Answer } from "./answer.js";
import { loadDocuments, loadStructured } from "./corpus.js";

const client = new Anthropic();

// Loaded once. The corpus does not change mid-conversation, and re-reading
// seven files per turn is work with no purchaser.
const docs = loadDocuments();
const structured = loadStructured();
const rules = rulesFrom(structured);

const closures = rules.closures;

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

/** Where escalations go. One per process; the human console reads the same file. */
export const queue = new Queue();
/** Actions the agent has drafted and a human must approve. See assisted mode. */
export const actions = new Actions();
/** Bounds on what the agent can do, per turn, per session, per hour. */
export const limiter = new RateLimiter();

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
  /**
   * Set once the conversation has been handed to a person and must NOT
   * continue. Only emotional triggers do this — a member routed to the
   * club secretary after a bereavement should not find themselves back
   * in a booking flow two turns later. A competition-results
   * escalation, by contrast, leaves them free to book a tee time.
   */
  halted?: Handoff;
  /** Tool signatures this session, for loop detection. */
  /** One conversation, one trace. */
  traceId: string;
  fired: string[];
  /**
   * Everything that has actually happened this SESSION.
   *
   * ATTEMPTED read "(nothing)" on an escalation where the agent had
   * booked two tee times and been refused a third — because the
   * escalation fired on a LATER TURN than the tool calls, and was
   * handed that turn's empty list. The field the handoff depends on
   * most was empty exactly when there was most to say.
   *
   * A handoff summarises a conversation, not a turn.
   */
  happened: Reply[];
  /**
   * A policy refusal happened last turn.
   *
   * Frustration ALONE is a member having a bad day and is not a
   * handoff. Frustration immediately after being told no is the club's
   * named accountable owner needing to make a judgement the rules do
   * not let the agent make.
   */
  refusedLastTurn?: string;
  /**
   * The member's live bookings, loaded lazily and refreshed after any
   * write.
   *
   * Asked to "cancel that please", the model called list_my_bookings to
   * find the id — which is terminal, so the turn ended and the member
   * got a list instead of a cancellation. Every cancellation cost two
   * turns because the agent began each session not knowing what the
   * member had booked.
   *
   * It is a fact the tee sheet holds, so it is a LOOKUP, not a
   * conversation step. Day 11's rule, applied to session setup rather
   * than to memory.
   */
  bookings?: { id: string; slotId: string; guests: number }[];
  /**
   * Escalations a human resolved that this member has not been told
   * about yet. Loaded once per session and mentioned once.
   */
  resolved?: { ref: string; summary: string; whatIDid: string; by: string }[];
  /** Consecutive turns where the corpus could not answer. */
  fruitless: number;
  pendingMemory?: { key: string; value: string; quote: string; turn: string };
  /** This turn's view of pendingMemory, snapshotted at the top of turn(). */
  consumable?: { key: string; value: string; quote: string; turn: string };
}

export const newSession = (memberId: string): Session => ({
  memberId,
  sessionId: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  step: 0,
  history: [],
  offered: new Map(),
  memories: memory.recall(memberId),
  traceId: randomUUID(),
  fired: [],
  happened: [],
  fruitless: 0,
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
  | {
      kind: "booking";
      outcome: BookOutcome;
      /**
       * The time the MEMBER asked for, so code can notice a swap.
       *
       * A member asked for 9:40, found it taken, and was booked at 9:50
       * with no acknowledgement that they had not got what they asked
       * for. The confirmation was truthful — it said 09:50 — but a
       * truthful answer to a question nobody asked is how the day-11
       * wrong-memory failure worked too.
       *
       * The model's explanation lived in a preamble, and preambles are
       * now suppressed because they make promises the code has not
       * kept. That fix traded false promises for lost context, so the
       * context comes back here where it can be checked.
       */
      requested?: string;
    }
  | { kind: "cancelled"; ok: boolean }
  | { kind: "amended"; outcome: AmendOutcome }
  /**
   * Drafted, not done. Assisted mode.
   *
   * The agent has gathered everything and written the exact call; a
   * human approves it before it runs. Carries the action so the caller
   * can queue it and the member can be told honestly that nothing has
   * happened yet.
   */
  | { kind: "proposed"; action: PendingAction }
  | { kind: "memories"; memories: Memory[] }
  | { kind: "bookings"; bookings: { id: string; slotId: string; guests: number }[] }
  | { kind: "verbatim"; answer: Answer; badCitations: { source: string; why: string }[]; staleSources: { id: string; reviewDue: string }[] }
  | { kind: "error"; text: string }
  /**
   * Subordinate to the answer, whatever order the tools ran in.
   *
   * A member asked to be booked and read "Would you like me to
   * remember that — early morning?" BEFORE their confirmation, because
   * the model happened to call remember_preference first. Tool order is
   * an implementation detail of one model call; what the member came
   * for is not. Asides sort last.
   */
  | { kind: "aside"; text: string }
  /**
   * Handed to a person. Carries the package so the caller can queue it,
   * show it, or assert on it — the member-facing sentence is only one
   * of the three things an escalation produces.
   */
  | { kind: "escalated"; handoff: Handoff }
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
  | {
      kind: "trace";
      tool: string;
      args: unknown;
      note: string;
      /**
       * Why, in words a person can read.
       *
       * The note beside it is written FOR THE MODEL — "Not booked
       * (not_permitted). The member has been told. Do not invent a fix."
       * — and a staff member reading a handoff was getting that. Third
       * audience for the same content, and the second time internal
       * text has reached someone it was not written for.
       */
      detail?: string;
      /**
       * Did it work? Decided AT THE SOURCE.
       *
       * The handoff package used to infer this by matching the note
       * against /^(Refused|Not stored)/ — and a refused booking whose
       * note began "Not booked (not_permitted)" was reported to a staff
       * member as "✓ Booked". Determining truth by parsing prose, in
       * the artefact somebody uses to decide what to do, when the
       * outcome was known here and thrown away.
       */
      ok: boolean;
    };

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
  "hand_to_a_person",
  "search_knowledge",
  "end_turn",
  // Memory is shown from the store, not described by the model — and
  // the same goes for changing it. A correction produced "Updated —
  // thanks." from code and then "Done — I've updated that." from the
  // model on a second inference, because these two were not terminal.
  // If code writes the reply there is nothing left for the model to
  // add, and what it adds is a second voice saying the same thing.
  "show_what_you_know",
  "update_what_you_know",
  "forget_everything",
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
  "amend_booking",
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
    //
    // ONLY FOR SHOWING, NEVER FOR LOOKING UP. The member's bookings and
    // their ids are already in your instructions, refreshed from the
    // tee sheet at the start of this turn. Asked to "cancel that
    // please", the model called this first — which is terminal, so the
    // turn ended and the member got a list instead of a cancellation.
    description:
      "Show the member their bookings, when they ASK to see them. " +
      "Do NOT call this to find a booking id — you already have their bookings and ids in " +
      "your instructions above. If they asked you to cancel something, call cancel_booking " +
      "with the id you already have.",
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
        requestedTime: {
          type: "string",
          description:
            "The time the MEMBER asked for, HH:MM, even when you are booking a different " +
            "one because theirs was taken. Omit only if they never named a time.",
        },
        partySize: { type: "number", description: "Total players including the member." },
        guests: { type: "number", description: "How many of the party are guests." },
      },
      required: ["slotId", "partySize", "guests"],
    },
  },
  {
    name: "amend_booking",
    // CHANGING A BOOKING IS ONE INTENT.
    //
    // A member asked "but the second person is a guest?" and the model
    // called cancel_booking, said "That's cancelled", and ended the
    // turn — because there was no tool for changing a booking, so it
    // built one out of two irreversible steps and got the order wrong
    // across two turns.
    description:
      "Change an existing booking: the number of players, the number of guests, or the " +
      "time. Use this whenever a member corrects a detail of a booking they already have. " +
      "NEVER cancel and rebook to make a change — this does it in one step, puts the " +
      "original back if it fails, and does not charge a late cancellation fee.",
    input_schema: {
      type: "object",
      properties: {
        bookingId: { type: "string", description: "The booking to change." },
        partySize: { type: "number", description: "Total players including the member, AFTER the change." },
        guests: { type: "number", description: "How many of the party are guests, AFTER the change." },
        slotId: {
          type: "string",
          description: "Only if they want a different TIME. Omit to keep the same slot.",
        },
      },
      required: ["bookingId", "partySize", "guests"],
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
        quote: {
          type: "string",
          description:
            "The member's own words, verbatim and trimmed to the part that states the " +
            "preference — 'I usually play early', not the whole sentence. THIS IS THE " +
            "MEMORY: it is what we store, what we show them, and what you will be told " +
            "next time. Do not paraphrase it.",
        },
      },
      required: ["key", "quote"],
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
    name: "hand_to_a_person",
    // THE MODEL MAY ONLY RAISE THE TRIGGERS THAT ARE ITS OWN JUDGEMENT.
    //
    // Three capability reasons, and no others. A bereavement, a request
    // for a human, a loop and a step limit are detected in code, from
    // the member's words or from a count — none of them is a judgement
    // call, and letting the model declare them would make the most
    // important triggers in the system depend on it noticing.
    //
    // Conversely, "this is outside what I can do" genuinely IS a
    // judgement, and code cannot make it.
    description:
      "Hand the conversation to a member of staff, when it is something you cannot do. " +
      "Use membership_enquiry for joining or membership packages; competition_results for " +
      "competition results or scores; not_in_knowledge_base when the club's documents and " +
      "your tools genuinely do not cover what they asked. " +
      "Do NOT use this because the member is upset, or because they asked for a person — " +
      "both are handled already. Do not use it to avoid a difficult question you could " +
      "answer with a tool.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["membership_enquiry", "competition_results", "not_in_knowledge_base"],
        },
        summary: {
          type: "string",
          description:
            "One sentence a staff member reads first: what they want, in their terms. " +
            "Not what you did about it.",
        },
      },
      required: ["reason", "summary"],
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
NEXT one — never a past date. Members can book up to ${rules.maxDaysAhead} days ahead.

You are the member services agent for a golf club.

You route. You do not answer from your own knowledge.

You know nothing about this club that a tool has not told you. You have never
seen its fees, its dress code, its opening hours or its booking rules. If you
find yourself about to state a fact about the club, that is a tool call you
have not made yet.

Their bookings, with ids, are listed below. Use them directly — do not look them
up before acting on them.

If a member corrects a detail of a booking they already have — the number of
players, the number of guests, the time — call amend_booking with the id from
that list. Do it in the same turn, without checking anything first. Never
cancel and rebook to make a change: it destroys their booking, and cancelling
inside 24 hours charges them a fee for fixing your mistake.

Anything about rules, fees, hours, dress code, competitions or etiquette goes
to search_knowledge. It replies to the member itself, with sources — so do not
introduce it ("let me look that up"), do not summarise it afterwards, and do
not restate what you think it said. Call the tool; the turn ends there.

If a question is not about the club at all, say so briefly.

Be warm and short. Members are usually on a phone.
${recalled(s)}${held(s)}${handedBack(s)}`;
};

/**
 * What a human did after the agent handed this member over.
 *
 * Mentioned FIRST and briefly — a member who has just spoken to the pro
 * shop wants to know the agent knows, not to be told the whole story
 * back. And it is the agent's job to raise it: making them ask "did you
 * get my message?" is the failure this exists to prevent.
 */
function handedBack(s: Session): string {
  if (!s.resolved?.length) return "";
  const lines = s.resolved.map(
    (r) => `- ${r.summary} — ${r.by} dealt with it: ${r.whatIDid} (ref ${r.ref})`,
  );
  // FOR CONTEXT ONLY. The member has already been told, in code, at the
  // top of this turn — so this is here to stop the model repeating it
  // or contradicting it, not to ask it to deliver the news.
  return (
    `\n\nA member of staff has just resolved something you escalated, and THE MEMBER HAS ` +
    `ALREADY BEEN TOLD at the start of this reply. Do not repeat it. Carry on with what ` +
    `they actually asked for:\n${lines.join("\n")}`
  );
}

/**
 * The member's current bookings, as fact rather than memory.
 *
 * These come from the tee sheet on every session, so they carry no
 * "may be out of date" caveat — unlike memory directly above, which
 * does. The two blocks sit next to each other in the prompt and must
 * not read alike: one is a record and the other is a belief.
 */
function held(s: Session): string {
  if (!s.bookings?.length) return "\n\nThey have no bookings at the moment.";
  const lines = s.bookings.map((b) => {
    const [d, t] = b.slotId.split("T");
    return `- ${d} at ${t}${b.guests ? `, ${b.guests} guest(s)` : ""} — booking id ${b.id}`;
  });
  // AT THE LIMIT IS A FACT, NOT AN INFERENCE.
  //
  // The list alone was not enough: shown two bookings and a rule of
  // two, the model offered a third set of times and the member picked
  // one before being refused. Counting is not the model's job when the
  // count is already known here.
  const full =
    s.bookings.length >= rules.maxLivePerMember
      ? `\n\nThey are AT the limit of ${rules.maxLivePerMember} live bookings. They cannot ` +
        `book anything else until one of these is cancelled or played. Say so BEFORE ` +
        `offering times, not after they have chosen one.`
      : "";
  return `\n\nTheir current bookings, from the tee sheet just now:\n${lines.join("\n")}${full}`;
}

// STAMPED ON EVERY SPAN, and computed from content rather than
// declared. Every YAML here carries a hand-maintained `last_updated`,
// which is a claim somebody has to remember to make true.
//
// The prompt version hashes systemPrompt's own SOURCE — the template,
// not the rendered string, which varies per member with their memories
// and bookings. Two members on the same prompt must stamp the same
// version, or the field cannot answer "what changed on Monday".
setVersions(
  computeVersions({
    model: MODEL,
    promptTemplate: systemPrompt.toString(),
    docs: docs.map((d) => ({ id: d.id, body: d.body })),
    structured,
  }),
);

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
  // FROM THE RULEBOOK, NOT A LITERAL. This was `42`, duplicating
  // booking-rules.yaml's max_days_ahead — so changing the club's rule
  // would have changed what the agent SAYS and not what it DOES.
  const ahead = rules.maxDaysAhead;
  const limit = new Date(now.getTime() + ahead * 864e5).toLocaleDateString("en-CA", {
    timeZone: "Australia/Sydney",
  });
  if (isoDate > limit) return `${isoDate} is more than ${ahead} days ahead (the limit is ${limit}).`;
  void y; void m; void d;
  return undefined;
}

/** The conversation so far, in plain text, for the handoff package. */
function transcriptOf(s: Session): { role: string; text: string }[] {
  // THE MEMBER'S SIDE FROM history, THE AGENT'S SIDE FROM WHAT WE SENT.
  //
  // Reading history for both showed the staff member model PREAMBLES —
  // "Great! 9:00 is available. Let me book that for you" — which are
  // suppressed from members and which sometimes describe things that
  // did not then happen. The confirmations the member actually read are
  // code-generated Reply objects and were nowhere in it.
  //
  // A transcript that shows what the model said rather than what the
  // member read is the same defect as a trace logging requests as
  // outcomes, in the artefact a human uses to decide what to do.
  const out: { role: string; text: string }[] = [];
  const agentSaid = s.happened
    .filter((r) => r.kind !== "trace")
    .map((r) => memberSentence(r))
    .filter((t): t is string => t !== null);

  let i = 0;
  for (const m of s.history) {
    if (m.role === "user" && typeof m.content === "string") {
      out.push({ role: "member", text: m.content });
      if (agentSaid[i]) out.push({ role: "agent", text: agentSaid[i]! });
      i++;
    }
  }
  for (; i < agentSaid.length; i++) out.push({ role: "agent", text: agentSaid[i]! });
  return out;
}

/**
 * Hand this conversation to a person.
 *
 * Builds the package, puts it in the queue, and returns what the member
 * sees — three outputs from one call, because an escalation that
 * produces a sentence but no queue entry is an agent quietly ending the
 * conversation, which is the failure mode this whole day exists to
 * prevent.
 */
function escalate(
  s: Session,
  triggerId: string,
  summary: string,
  soFar: Reply[],
  sentiment?: string,
): Reply {
  // The whole session, not the caller's fragment — see Session.happened.
  const everything = [...s.happened, ...soFar];
  const handoff = buildHandoff({
    memberId: s.memberId,
    triggerId,
    summary,
    replies: everything,
    transcript: transcriptOf(s),
    sentiment,
  });
  queue.add(handoff);
  void span(
    {
      type: "escalation",
      name: triggerId,
      input: { summary, sentiment },
      meta: () => ({
        output: { ref: handoff.ref, urgency: handoff.urgency, team: handoff.team, missing: handoff.missing },
        outcome: "denied" as const,
      }),
    },
    async () => handoff,
  );
  return { kind: "escalated", handoff };
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
/** The late cancellation fee, from fees.yaml. Never a literal. */
function lateCancellationFee(): number | undefined {
  const fees = structured["fees.yaml"] as { cancellation?: { late_fee?: number } } | undefined;
  return fees?.cancellation?.late_fee;
}

const slotParts = (slotId: string) => {
  const [date, time] = slotId.split("T");
  return { date: date ?? slotId, time: time ?? "" };
};

/**
 * How the loop reaches a model.
 *
 * Injected so the loop can be tested WITHOUT one. It was not, for a
 * day, and the cost was visible: every defect that lived in the loop —
 * a preamble shown to a member, a consent draft armed without asking,
 * "no thanks" reaching for cancel_booking, an aside printed before the
 * answer — was found by a person typing at it and could not be pinned
 * down by a test afterwards.
 *
 * CLAUDE.md asks this of every review: is it testable without an LLM?
 * If not, the logic and the model call are tangled. They were, here, in
 * the largest file in the project.
 */
export type ModelFn = (req: {
  system: string;
  tools: Tool[];
  messages: MessageParam[];
  tool_choice: { type: "any" } | { type: "auto" };
}) => Promise<{ content: Anthropic.ContentBlock[]; stop_reason: string | null }>;

/**
 * Tokens spent this process, across BOTH model calls the agent makes:
 * the routing loop here, and the knowledge lookup inside ask().
 *
 * Exists because "should the paid suites run on every commit?" is a
 * question with a number attached, and the number was being estimated.
 * A suite whose cost you have not measured is a suite you will either
 * over-run or quietly stop running.
 */
export const usage = { input: 0, output: 0 };

/** Haiku 4.5 is $1/$5 per MTok; Opus 5 is $5/$25. */
export const spent = (): number => {
  const p = MODEL.includes("haiku") ? { in: 1, out: 5 } : { in: 5, out: 25 };
  return (usage.input / 1e6) * p.in + (usage.output / 1e6) * p.out;
};

const liveModel: ModelFn = async (req) => {
  const r = await client.messages.create({ model: MODEL, max_tokens: 1024, ...req });
  usage.input += r.usage.input_tokens;
  usage.output += r.usage.output_tokens;
  return r;
};

/** One member turn. Returns everything the member should see, in order. */
export async function turn(
  s: Session,
  input: string,
  model: ModelFn = liveModel,
): Promise<Reply[]> {
  // ONE CONVERSATION IS ONE TRACE. Every span below nests inside it,
  // and the whole thing is wrapped rather than reported afterwards so
  // that duration and outcome are facts rather than something the
  // caller has to remember to get right.
  return trace({ sessionId: s.sessionId, memberId: s.memberId, traceId: s.traceId }, () =>
    span(
      {
        type: "turn",
        name: `turn.${s.history.filter((m) => typeof m.content === "string").length + 1}`,
        input,
        meta: (replies: Reply[]) => ({
          output: replies.map((r) => (r.kind === "trace" ? `→${r.tool}` : r.kind)),
          outcome: replies.some((r) => r.kind === "escalated")
            ? ("denied" as const)
            : replies.some((r) => r.kind === "error")
              ? ("error" as const)
              : ("ok" as const),
        }),
      },
      () => runTurn(s, input, model),
    ),
  );
}

async function runTurn(
  s: Session,
  input: string,
  model: ModelFn = liveModel,
): Promise<Reply[]> {
  // Snapshot and clear: a proposal is answerable for one turn only.
  s.consumable = s.pendingMemory;
  s.pendingMemory = undefined;

  s.history.push({ role: "user", content: input });

  // THE KILL SWITCH IS CHECKED FIRST, BEFORE ANYTHING ELSE.
  //
  // Not after the escalation checks, not after the memory load — the
  // point of a kill switch is that nothing happens, including the
  // things that look harmless. It is a file, so whoever is awake at 3am
  // can flip it without a deploy.
  const off = disabled();
  if (off) {
    return [
      {
        kind: "text",
        text:
          `I'm not able to help at the moment — the pro shop are on ${
            (structured["contacts.yaml"] as { contacts?: { pro_shop?: { phone?: string } } })
              ?.contacts?.pro_shop?.phone ?? "the club number"
          } and can sort anything out.`,
      },
      { kind: "trace", tool: "(kill-switch)", args: { reason: off }, note: off, ok: true },
    ];
  }

  // ── ESCALATION CHECKS RUN BEFORE THE MODEL DOES ────────────────
  //
  // Not for cost. An LLM should not be composing a first response to a
  // bereavement, however good it would be at it, and an agent that
  // "considers" a request for a human before granting it has already
  // failed the member.

  // Already handed to a person, and the trigger was one that must not
  // route them back into software.
  if (s.halted) {
    return [
      {
        kind: "text",
        text:
          `The club secretary has your details and will be in touch. ` +
          `Your reference is ${s.halted.ref}.`,
      },
    ];
  }

  // Frustration only counts alongside a refusal — see refusedLastTurn.
  if (s.refusedLastTurn && soundsFrustrated(input)) {
    const why = s.refusedLastTurn;
    s.refusedLastTurn = undefined;
    return [
      escalate(
        s,
        "refused_and_frustrated",
        `Refused: ${why}. The member is unhappy with the decision.`,
        [],
        "frustrated",
      ),
    ];
  }
  s.refusedLastTurn = undefined;

  // REVERSE HANDOFF, loaded once per session.
  //
  // The pro shop rings the member, sorts it out, and the member comes
  // back to the agent that escalated them. Without this it starts from
  // nothing and they explain it all again — which is worse than if the
  // agent had never been involved, because it added a round trip to a
  // conversation that still had to happen.
  if (s.resolved === undefined) {
    s.resolved = queue.awaitingMention(s.memberId).map((h) => ({
      ref: h.ref,
      summary: h.summary,
      whatIDid: h.resolution!.whatIDid,
      by: h.resolution!.resolvedBy,
    }));
    // Said once. Marked before the turn runs, so a crash mid-turn does
    // not produce an agent that opens every future conversation with
    // the same old news.
    for (const r of s.resolved) queue.markTold(r.ref);
  }

  // Loaded once per session, refreshed after any write. A failure here
  // is not fatal — the model falls back to list_my_bookings.
  if (s.bookings === undefined) {
    s.bookings = await listBookings(s.memberId)
      .then(({ bookings }) => bookings)
      .catch(() => []);
  }

  const vuln = vulnerability(input);
  if (vuln) {
    // Unconditional. The original task is ABANDONED, not completed
    // first — someone telling you a spouse has died is not a member
    // with a booking query who also mentioned something.
    const r = escalate(s, vuln, input.trim(), [], "vulnerable — handle personally");
    if (r.kind === "escalated") s.halted = r.handoff;
    return [r];
  }

  if (askedForAHuman(input)) {
    // ALWAYS HONOURED, NEVER NEGOTIATED. The conversation is not
    // halted — they can carry on talking to the agent if they want —
    // but the callback is booked and nobody argues about it.
    return [escalate(s, "asked_for_a_human", input.trim(), [], "asked to speak to somebody")];
  }

  // A BARE YES OR NO ANSWERS THE QUESTION WE JUST ASKED. CODE DECIDES.
  //
  // Asked "would you like me to remember that?", a member replied "no
  // thanks" and the model called cancel_booking. They declined a memory
  // offer and nearly lost their tee time; it survived only because the
  // model passed a slot id where a booking id was wanted.
  //
  // The mirror of that failure had already happened in the other
  // direction — a "yes please" meant for a tee time being spent on a
  // memory — and both come from the same place: a one-word answer is
  // meaningless without the question, and a model asked to infer which
  // question it answers will sometimes pick the destructive reading.
  //
  // We know which question was asked, because we asked it. So this
  // short-circuits before the model is called at all. No inference, no
  // tool, no cost, and nothing left to misread.
  if (s.consumable && (isAffirmative(input) || isNegative(input))) {
    const draft = s.consumable;
    s.consumable = undefined;

    if (isNegative(input)) {
      s.history.push({ role: "assistant", content: "No problem — I won't note it down." });
      return [{ kind: "text", text: "No problem — I won't note it down." }];
    }

    // Same rule on the consent path: the turn that produced the offer
    // is checked, not just the trimmed quote the model proposed.
    const blocked = excludedBy(draft.turn);
    const r = blocked
      ? ({ refused: blocked } as const)
      : memory.remember(s.memberId, {
          type: "preference",
          key: draft.key,
          value: draft.value,
          confidence: 0.95,
          source: { sessionId: s.sessionId, turnIndex: s.history.length, quote: draft.quote },
        });
    const text =
      "refused" in r
        ? `I'll keep that in mind for now, but I won't write it down.`
        : `Noted — I'll remember that.`;
    s.history.push({ role: "assistant", content: text });
    s.memories = memory.recall(s.memberId);
    return [{ kind: "text", text }];
  }

  const out: Reply[] = [];
  // Across the WHOLE turn. `calls.indexOf(call)` counted within a
  // single inference, so six inferences of one call each never tripped
  // it — which is precisely the shape the ceiling exists to bound.
  let callsThisTurn = 0;

  // THE HANDOFF COMES BACK IN CODE, AND LEADS.
  //
  // The first version asked the MODEL to mention it in the prompt. It
  // never did — the member's first question went to search_knowledge,
  // which is terminal, so the turn ended and the model never spoke at
  // all. Asking a model to say something in a turn where it may not get
  // a word in is not a mechanism.
  //
  // It leads rather than trailing as an aside, because a member who has
  // just spoken to the pro shop wants to know the agent knows before
  // anything else happens.
  if (s.resolved?.length) {
    const said = s.resolved;
    s.resolved = [];
    for (const r of said) {
      out.push({
        kind: "text",
        text:
          `Before anything else — ${r.by} at the club looked at ${r.ref} and got back to ` +
          `you: ${r.whatIDid}`,
      });
    }
  }

  for (let i = 0; i < MAX_STEPS; i++) {
    const rendered = systemPrompt(s);
    const response = await span(
      {
        type: "llm",
        name: `llm.turn-step-${i + 1}`,
        // THE FULL CONTEXT WINDOW. The field people drop to save space
        // and then need — it is the input to the decision, and without
        // it a trace can say what the model did and never why.
        input: { system: rendered, messages: s.history, toolChoice: i === 0 ? "any" : "auto" },
        meta: (r: Awaited<ReturnType<ModelFn>>) => {
          // Cost attribution lives on the span that spent it, so "cost
          // per resolution" is a query rather than an estimate.
          const u = (r as { usage?: { input_tokens: number; output_tokens: number } }).usage;
          const price = MODEL.includes("haiku") ? { in: 1, out: 5 } : { in: 5, out: 25 };
          return {
            output: r.content,
            tokensIn: u?.input_tokens ?? 0,
            tokensOut: u?.output_tokens ?? 0,
            costAud: ((u?.input_tokens ?? 0) / 1e6) * price.in + ((u?.output_tokens ?? 0) / 1e6) * price.out,
            outcome: "ok" as const,
          };
        },
      },
      () => model({
      system: rendered,
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
      }),
    );

    s.history.push({ role: "assistant", content: response.content });

    // TEXT ALONGSIDE TOOL CALLS IS A PREAMBLE, NOT A REPLY.
    //
    // A member asked to book 9:40 and was told: "Let me book that for
    // you and save that you like to play early." The save was then
    // REFUSED by the write policy. The member had been told about
    // something that never happened.
    //
    // The sentence was written in the same message as the tool calls,
    // before any of them ran — so it is the model narrating its
    // intentions, and an intention stated before the code has decided
    // is a claim it has no standing to make. Every one of these is
    // either noise ("let me check that for you") or a promise about an
    // outcome nobody knows yet.
    //
    // A message with NO tool calls is different: that is the model
    // narrating a result it has already seen, which is the legitimate
    // path for reads. So the rule is structural rather than a
    // judgement about the wording — if the message also calls a tool,
    // the prose is a preamble and goes to the developer view.
    const calls = response.content.filter((b) => b.type === "tool_use");
    for (const block of response.content) {
      if (block.type !== "text" || !block.text.trim()) continue;
      if (calls.length > 0) {
        out.push({ kind: "trace", tool: "(preamble)", args: {}, note: block.text.trim(), ok: true });
      } else {
        out.push({ kind: "text", text: block.text.trim() });
      }
    }

    if (response.stop_reason !== "tool_use") return ordered(out);

    const results: Anthropic.ToolResultBlockParam[] = [];
    let terminated = false;

    for (const call of calls) {
      s.step++;

      // THE SAME CALL THREE TIMES IS NOT PROGRESS.
      //
      // Caught here rather than by the step ceiling because a loop of
      // three identical calls and a loop of six varied ones are
      // different problems: this one means the agent is stuck on a
      // fact it cannot get, which a person can supply in seconds.
      // RATE LIMITED BEFORE IT RUNS. MAX_STEPS bounds inferences; a
      // model may issue any number of PARALLEL calls per inference, and
      // a red-team attack made 12 calls inside a ceiling of 6 steps.
      const refusal = limiter.check({
        memberId: s.memberId,
        sessionId: s.sessionId,
        tool: call.name,
        callsThisTurn,
      });
      if (refusal) {
        out.push({
          kind: "trace",
          tool: "(rate-limit)",
          args: { tool: call.name, limit: refusal.limit },
          note: refusal.detail,
          ok: false,
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            `Refused by a rate limit: ${refusal.detail}. Do not retry. Tell the member you ` +
            `cannot do any more just now and the pro shop can help.`,
        });
        continue;
      }
      callsThisTurn++;
      limiter.record({ memberId: s.memberId, sessionId: s.sessionId, tool: call.name });

      const signature = `${call.name}:${JSON.stringify(call.input)}`;
      s.fired.push(signature);
      if (s.fired.filter((f) => f === signature).length >= 3) {
        out.push(
          escalate(
            s,
            "went_in_circles",
            `Agent called ${call.name} with the same arguments three times.`,
            out,
            "unknown",
          ),
        );
        return ordered(out);
      }
      const { reply, forModel, effectiveArgs, ok, detail } = await span(
        {
          type: call.name === "search_knowledge" ? "knowledge" : "tool",
          name: call.name,
          input: call.input,
          meta: (r: Awaited<ReturnType<typeof execute>>) => ({
            // WHAT WAS EXECUTED, not what was requested. Day 12 had a
            // trace log the model's arguments as though they were the
            // outcome, and everything downstream read a request as a
            // fact.
            output: { args: r.effectiveArgs ?? call.input, note: r.forModel, detail: r.detail },
            outcome: r.ok === false ? ("denied" as const) : ("ok" as const),
          }),
        },
        () => execute(s, call.name, call.input),
      );
      // THE TRACE RECORDS WHAT WAS DONE, NOT WHAT WAS ASKED FOR.
      //
      // A guard corrected a party size from four to one and the trace
      // still showed four, because it logged the model's arguments.
      // Everything downstream then read a request as an outcome — the
      // conversational eval asserted against it and failed a booking
      // that had actually been made correctly.
      //
      // A trace that shows the request but not the correction is a
      // trace that lies about what happened, which is worse than no
      // trace: it is confidently wrong in the one artefact you consult
      // when something has gone wrong.
      const trace: Reply = {
        kind: "trace",
        tool: call.name,
        args: effectiveArgs ?? call.input,
        note: forModel,
        ok: ok ?? true,
        detail,
      };
      out.push(trace);
      s.happened.push(trace);
      if (reply) {
        out.push(reply);
        s.happened.push(reply);
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: forModel });

      // A TOOL IS TERMINAL BECAUSE IT ANSWERED THE MEMBER, NOT BECAUSE
      // OF ITS NAME.
      //
      // book_tee_time is terminal, so a REFUSED booking ended the turn
      // too: the solo guard caught "just me" being booked as four,
      // returned a refusal telling the model to book it as one — and
      // the turn stopped before the model could read it. The member got
      // no booking at all, which is worse than the wrong one the guard
      // was preventing.
      //
      // A guard that turns a bad outcome into no outcome has not
      // helped. The reply is the signal: if the tool produced something
      // for the member, the turn is done; if it only produced an
      // instruction for the model, the model must get to act on it.
      if (TERMINAL.has(call.name) && reply) terminated = true;
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
    if (terminated) return ordered(out);
  }

  // RAN OUT OF STEPS → A PERSON, NOT A DEAD END.
  //
  // The previous version apologised and stopped, which leaves the
  // member with nothing and the club with no record that anything went
  // wrong. Hitting the ceiling is the clearest possible signal that the
  // agent is out of its depth, and it was the one signal being thrown
  // away.
  out.push(
    escalate(
      s,
      "went_in_circles",
      `Agent hit the ${MAX_STEPS}-step limit on: "${input.trim()}"`,
      out,
      "unknown — the agent did not get far enough to tell",
    ),
  );
  return ordered(out);
}

/** Asides last. Traces keep their position — they are a developer's timeline. */
const ordered = (out: Reply[]): Reply[] => [
  ...out.filter((r) => r.kind !== "aside"),
  ...out.filter((r) => r.kind === "aside"),
];

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
): Promise<{
  reply?: Reply;
  forModel: string;
  effectiveArgs?: Record<string, unknown>;
  /** Whether the tool did what it was asked. Defaults to true. */
  ok?: boolean;
  /** Why not, for a human reader. Never the model-facing note. */
  detail?: string;
}> {
  if (name === "search_knowledge") {
    const { question } = input as { question: string };
    // WRAPPED, not reported afterwards. The previous version emitted
    // this span around an already-resolved value, so every one recorded
    // 0ms — a duration that is not merely missing but WRONG, in the
    // column you would use to find a slow call.
    const r = await span(
      {
        type: "knowledge",
        name: "ask",
        // THE FULL CONTEXT WINDOW, like every other llm call.
        input: { question, system: "" },
        meta: (x: Awaited<ReturnType<typeof ask>>) => ({
          input: { question, system: x.systemPrompt },
          output: { status: x.answer?.status, citations: x.answer?.citations, bad: x.badCitations },
          tokensIn: x.usage.input,
          tokensOut: x.usage.output,
          costAud: (x.usage.input / 1e6) * 1 + (x.usage.output / 1e6) * 5,
          outcome: (x.badCitations.length > 0 ? "error" : "ok") as "ok" | "error",
        }),
      },
      () => ask(question, docs, structured),
    );
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    if (!r.answer) {
      return {
        reply: { kind: "error", text: "Something went wrong looking that up — try me again?" },
        forModel: "The knowledge base failed to answer. Do not guess.",
      };
    }
    // THREE ABSTENTIONS IN A ROW IS NOT THE MEMBER PHRASING IT BADLY.
    //
    // It is the club's documents not containing the answer, which is a
    // knowledge gap a person can close in a minute and the agent never
    // will. Counted rather than judged, and reset the moment the corpus
    // answers something.
    if (r.answer.status === "not_in_knowledge_base") {
      s.fruitless++;
      if (s.fruitless >= 3) {
        s.fruitless = 0;
        return {
          reply: escalate(s, "repeated_rephrasing", `Asked three times, nothing found. Last: "${question}"`, [], "likely frustrated"),
          forModel: `Handed to staff after three unanswerable questions. Say nothing further.`,
        };
      }
    } else {
      s.fruitless = 0;
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

    // THE MEMBER NAMED A WEEKDAY. THE DATE MUST BE THAT WEEKDAY.
    //
    // "Can I book for staturday 9am" was resolved to Sunday 30 August.
    // The model asked before booking, which is the right instinct, but
    // it had already looked up the wrong day and a "yes" would have
    // booked one out. Day 11 gave the model today's date, which fixed
    // the YEAR and left the DAY.
    const named = weekdayNamed(lastMemberTurn(s));
    const actual = weekdayOf(date);
    if (named && actual && named !== actual) {
      return {
        ok: false,
        forModel:
          `Refused: they said ${named} and ${date} is a ${actual}. Work out the right ` +
          `date for the next ${named} and call this again — do not ask them to confirm a ` +
          `date they did not give you.`,
      };
    }

    try {
      const { slots: raw } = await checkAvailability(date, from ?? "00:00", to ?? "23:59");

      // CLOSED SLOTS ARE FILTERED OUT, NOT REFUSED LATER.
      //
      // The booking guard below would reject a competition-window slot,
      // but by then the member has been offered six times they cannot
      // have and has picked one. Refusing an offer you made is a worse
      // experience than never making it — and the pattern all week has
      // been to remove the capability rather than catch the mistake.
      //
      // The tee sheet returns these because it does not know the rule;
      // the rule lives in booking-rules.yaml. That split is the whole
      // reason this filter exists here rather than there.
      const slots = raw.filter((sl) => !closedFor(sl.slotId, closures));
      const removed = raw.length - slots.length;

      // EVERY OFFERED SLOT GOES IN THE LEDGER, including the ones the
      // model chooses not to mention. If the tee sheet offered it, the
      // member may name it.
      for (const sl of slots) s.offered.set(sl.slotId, { date: sl.date, time: sl.time });

      // AT THE LIMIT ARMS THE FRUSTRATION TRIGGER.
      //
      // The warning below was added so a member is told they are at the
      // limit BEFORE being offered times — and it silently removed the
      // escalation, because the model then declined conversationally
      // and never called book_tee_time, so nothing returned
      // not_permitted.
      //
      // The trigger keyed on a MECHANISM (a tool refusing) rather than
      // on the FACT (the member was told no). A better answer to the
      // member removed a safety net, which is the kind of regression
      // that only shows up when somebody is cross.
      const atLimit = (s.bookings?.length ?? 0) >= rules.maxLivePerMember;
      if (atLimit) {
        s.refusedLastTurn = `they already hold ${s.bookings!.length} live bookings, which is the maximum`;
      }
      return {
        // The WEEKDAY goes back too. If the member said Saturday and
        // this says Friday, the model can see the mismatch — it could
        // not before, because a bare ISO date carries no day name.
        forModel:
          (atLimit
            ? `STOP: they already hold ${s.bookings!.length} live bookings, which is the ` +
              `maximum of ${rules.maxLivePerMember}. Do NOT offer any of these times — tell ` +
              `them they are at the limit and would need to cancel one first. `
            : "") +
          (removed > 0
            ? `NOTE: ${removed} slot(s) hidden — the tee sheet is closed then ` +
              `(${closures.map((c) => `${c.day} ${c.from}-${c.to}, ${c.reason}`).join("; ")}). ` +
              `Say so if it is relevant to what they asked for. `
            : "") +
          (slots.length === 0
            ? `No free slots on ${weekday(date)} ${date} in that window.`
            : `Free slots on ${weekday(date)} ${date}: ` +
              slots.map((x) => `${x.time} (${x.slotId})`).join(", ")),
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
    const { slotId, partySize, guests, requestedTime } = input as {
      slotId: string;
      partySize: number;
      guests: number;
      requestedTime?: string;
    };

    // "JUST ME" IS NOT A SUGGESTION.
    //
    // A member said "the 9:20, just me. I usually play early with the
    // same three lads" and was booked as four with three guests — $60
    // of fees nobody agreed to. The model read a description of a
    // HABIT as the party for THIS booking: the same conflation the
    // memory write policy exists to stop, arriving on the side that
    // costs money.
    //
    // The confirmation already names the party and the fee, so the
    // member can object. That is detection, and it is not a substitute
    // for this: by the time they object the booking is on the sheet
    // and the guest allowance is spent.
    //
    // Read from the MEMBER'S TURN, like every other guard here, and
    // never from the arguments the model chose.
    let party = partySize;
    let guestCount = guests;

    // GUESTS COST MONEY, SO THE MEMBER MUST HAVE MENTIONED SOMEBODY.
    //
    // Asked "how many in your party, and will you have any guests?" — a
    // compound question — a member answered "yes" and was booked for
    // two with one guest, a count nobody gave, at $20.
    //
    // The solo guard covers "just me". It did not cover SILENCE, which
    // is the commoner case: most members never announce that they are
    // playing alone. Refused rather than corrected, because unlike
    // "just me" there is no right answer to substitute — only the
    // member knows, and one clear question costs a turn where a wrong
    // guess costs a fee and a guest turned away.
    const saidSoFar = s.history
      .filter((m) => m.role === "user" && typeof m.content === "string")
      .map((m) => m.content as string);
    if (guestCount > 0 && !mentionedCompany(saidSoFar)) {
      return {
        ok: false,
        forModel:
          `Refused: you asked for ${guestCount} guest(s) and the member has never mentioned ` +
          `anyone playing with them. Guests are charged, so ask them plainly — "just you, or ` +
          `are you bringing anyone?" — in ONE question, and book what they answer.`,
      };
    }

    if (saidTheyArePlayingAlone(lastMemberTurn(s)) && (party > 1 || guestCount > 0)) {
      // CORRECTED, NOT REFUSED.
      //
      // The first version refused and told the model "book it as one
      // player, or ask them". It took the second option — compliant,
      // and the member ended the conversation with no booking at all.
      // Offering the model a choice put back exactly the
      // non-determinism the guard was removing.
      //
      // "Just me" is not ambiguous, and the regex excludes "just me
      // and my wife". So code believes the member over the model's
      // inference, books what they asked for, and the confirmation
      // states the party — which is where they would object if this
      // were ever wrong.
      //
      // This is the day-7 rule at its limit: the model proposes, code
      // disposes. Here the code holds better evidence than the model
      // does — the member's literal words — so it uses them.
      party = 1;
      guestCount = 0;
    }

    // THE TEE SHEET IS SHUT AT THIS TIME.
    //
    // booking-rules.yaml closes Saturday 08:30–11:00 for the club
    // competition, and the fake tee sheet — like the real Google Sheet
    // — will happily return those slots and accept a booking for them.
    // listCompetitions() has existed since day 10 and has never been
    // called by anything.
    //
    // Day 9 found this rule being answered WRONGLY and fixed it in the
    // corpus, so the knowledge agent states it correctly. The booking
    // path never learned. A corpus correction cannot reach a code path,
    // and the failure it was preventing — a member driving to a closed
    // tee sheet — was still live two days later.
    // The club's rules are enforced inside bookTeeTime, not here — a
    // guard in this layer holds only for callers who go through it, and
    // an audit script booking four guests against a two-guest rule
    // proved that the hard way.

    // THE LEDGER CHECK. A prompt asking the model to only book slots it
    // was shown is a request; this is a guarantee. It stops both a
    // transcription slip and a slot the model reasoned "should" be free.
    if (!s.offered.has(slotId)) {
      return {
        ok: false,
        forModel:
          `Refused: ${slotId} is not a slot the tee sheet offered in this conversation. ` +
          `Call check_availability and book one of the slot IDs it returns.`,
      };
    }

    try {
      const outcome = await bookTeeTime({
        slotId,
        memberId: s.memberId,
        partySize: party,
        guests: guestCount,
        sessionId: s.sessionId,
        clubRules: rules,
        step: s.step,
      });
      // Alternatives are offers too — a member may take one next turn.
      if (outcome.status === "slot_taken") {
        for (const a of outcome.alternatives) s.offered.set(a.slotId, slotParts(a.slotId));
      }
      // A POLICY REFUSAL ARMS THE FRUSTRATION TRIGGER.
      //
      // Frustration on its own is a member having a bad day and is not
      // a handoff. Frustration immediately after being told no is the
      // club's named accountable owner needing to make a judgement the
      // rules do not let the agent make.
      if (outcome.status === "not_permitted") s.refusedLastTurn = outcome.reason;

      return {
        ok: outcome.status === "booked",
        // The list is now stale. Reload before the next turn.
        ...(outcome.status === "booked" ? ((s.bookings = undefined), {}) : {}),
        detail:
          outcome.status === "not_permitted"
            ? outcome.reason
            : outcome.status === "slot_taken"
              ? "the slot had gone"
              : outcome.status === "unavailable"
                ? "the tee sheet could not be reached"
                : undefined,
        effectiveArgs: { slotId, partySize: party, guests: guestCount, requestedTime },
        reply: { kind: "booking", outcome, requested: requestedTime },
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

  if (name === "amend_booking") {
    const { bookingId, partySize, guests, slotId } = input as {
      bookingId: string;
      partySize: number;
      guests: number;
      slotId?: string;
    };
    try {
      const outcome = await amendBooking({
        bookingId,
        memberId: s.memberId,
        partySize,
        guests,
        slotId,
        sessionId: s.sessionId,
        clubRules: rules,
        step: s.step,
      });
      s.step += 2; // the amend consumed extra idempotency steps
      s.bookings = undefined;

      if (outcome.status === "lost") {
        // The member is worse off than before they spoke to us. Nothing
        // the agent can say fixes that, so a person is told immediately.
        return {
          ok: false,
          reply: escalate(
            s,
            "went_in_circles",
            `AMEND FAILED BADLY: ${outcome.reason} The member has NO booking and expects one.`,
            [],
            "will be upset — we cancelled their booking and could not replace it",
          ),
          forModel: `The booking is gone and could not be restored. A person has been told.`,
        };
      }
      if (outcome.status === "not_permitted") s.refusedLastTurn = outcome.reason;
      return {
        ok: outcome.status === "amended",
        detail: outcome.status === "amended" ? undefined : outcome.reason,
        reply: { kind: "amended", outcome },
        forModel:
          outcome.status === "amended"
            ? `Changed. The member has been shown the new details from the record.`
            : `Not changed (${outcome.status}). The member has been told.`,
      };
    } catch (e) {
      return {
        ok: false,
        reply: { kind: "error", text: (e as Error).message },
        forModel: `The change failed. Do not retry.`,
      };
    }
  }

  if (name === "cancel_booking") {
    const { bookingId } = input as { bookingId: string };

    // ── ASSISTED MODE ────────────────────────────────────────────
    //
    // Cancelling within 24 hours of the tee time costs the member $15.
    // Until now that rule lived in a TOOL DESCRIPTION — a request to
    // the model — so a member could be charged without being warned.
    // Day 10 recorded it as a known gap and it stayed open for two
    // days, which is what known gaps do without a forcing function.
    //
    // It is not escalated, because there is nothing for a human to work
    // out. It is DRAFTED: the agent finds the booking, computes the
    // window, computes the fee, writes the exact call, and a person
    // says yes or no in ten seconds. Most of the efficiency, with a
    // hard ceiling on the irreversible part.
    const booking = await listBookings(s.memberId)
      .then(({ bookings }) => bookings.find((b) => b.id === bookingId))
      .catch(() => undefined);

    if (booking) {
      const [d, t] = booking.slotId.split("T");
      const teeTime = new Date(`${d}T${t}:00+10:00`);
      const hours = (teeTime.getTime() - Date.now()) / 3600e3;
      const fee = lateCancellationFee();

      if (hours < 24 && hours > -24) {
        const action = actions.propose({
          ref: `ACT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          raisedAt: new Date().toISOString(),
          memberId: s.memberId,
          tool: "cancel_booking",
          args: { bookingId, memberId: s.memberId },
          effect:
            `Cancel ${d} at ${t} for ${s.memberId}` +
            (fee ? ` and charge the $${fee} late cancellation fee.` : "."),
          because: `Only ${Math.max(0, Math.round(hours))}h before the tee time — inside the 24-hour window.`,
          when: `${d} at ${t}`,
          fee,
        });
        return {
          ok: false,
          detail: "inside the 24-hour window; drafted for approval",
          reply: { kind: "proposed", action },
          forModel:
            `NOT cancelled. It is inside the 24-hour window, so it needs a person to approve ` +
            `the fee. The member has been told. Do not try again and do not promise it is done.`,
        };
      }
    }

    try {
      const r = await cancelBooking({
        bookingId,
        memberId: s.memberId,
        sessionId: s.sessionId,
        step: s.step,
      });
      return {
        ok: r.cancelled,
        ...((s.bookings = undefined), {}),
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
    const { key, quote } = input as { key: string; quote: string };

    // THE MEMBER'S WORDS ARE THE MEMORY.
    //
    // There used to be a separate model-written `value` — a short
    // paraphrase for the column. It produced "tee times early" from "I
    // usually play early", which was then read back to the member as
    // the thing they were being asked to agree to, and earlier "early",
    // which is not a sentence at all.
    //
    // A paraphrase adds a step where the model can garble or infer, in
    // the one place where being exactly right is the entire product. It
    // bought nothing: the quote is shorter, clearer, unambiguous, and
    // already required for provenance.
    //
    // Correcting a memory replaces the value with the member's
    // correction and leaves the quote as the original, so the two
    // diverge only when a person has deliberately changed something.
    const value = quote.trim().replace(/^["']|["']$/g, "");

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
      // ONE OFFER PER TURN.
      //
      // Told "just me. I usually play early with the same three lads",
      // the model proposed two memories and the member was asked two
      // questions with one slot to answer them — and the second
      // proposal overwrote the first, so a "yes" would have committed
      // whichever the model happened to send last. That is the bare-
      // affirmative ambiguity again, manufactured by us this time.
      if (s.pendingMemory) {
        return {
          forModel:
            `Not stored, and do not offer again this turn — you have already asked them ` +
            `about one thing. If they say yes you can raise the other next time.`,
        };
      }

      // ASKING AND ARMING ARE ONE ACT.
      //
      // The first version told the MODEL to ask. It could not: this
      // call arrived batched with book_tee_time, which is terminal, so
      // the turn ended in the same iteration and the instruction went
      // nowhere. The member was never asked — and pendingMemory was
      // armed anyway, so a stray "yes" to some later question would
      // have committed a memory nobody was offered. That is the exact
      // bug the pending-draft design existed to close, returning
      // through a different door.
      //
      // So code asks, in the same statement that arms it. If we armed
      // it, we asked. There is no ordering left to get wrong.
      s.pendingMemory = { key, value, quote, turn: turnText };
      return {
        reply: {
          kind: "aside",
          text: memoryOfferText(quote),
        },
        forModel:
          `Not stored — the member described a habit rather than asking you to remember it. ` +
          `They have BEEN ASKED whether to note it; say nothing further about it this turn.`,
      };
    }
    // EXCLUSIONS ARE CHECKED AGAINST WHAT THE MEMBER SAID, NOT AGAINST
    // WHAT THE MODEL HANDED US.
    //
    // A member said "I've had a knee replacement so remember I'll
    // always need a buggy". The model trimmed the quote to "I'll always
    // need a buggy" — correctly, by the tool description, which asks
    // for the part that states the preference — and the health rule saw
    // a clean string and let it through. The trim removed the very
    // clause the exclusion existed to catch.
    //
    // The trim is right for quality; the mistake was letting the guard
    // inspect the model's output. That is the model marking its own
    // homework, and it is exactly what the write policy above avoids by
    // reading the member's turn. Two guards on one turn should not
    // disagree about where the truth is.
    //
    // The full turn is CHECKED but never STORED — writing "knee
    // replacement" into the provenance field as evidence would be the
    // same failure wearing a different hat.
    const inTurn = excludedBy(turnText);
    if (inTurn) {
      return {
        reply: {
          kind: "text",
          text:
            `I'll help with that now, but I won't write it down — it touches on something ` +
            `personal and we don't keep records of that sort of thing.`,
        },
        forModel: `Refused (${inTurn}) — it is in what they said. Help them THIS TURN, do not retry.`,
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

  if (name === "hand_to_a_person") {
    const { reason, summary } = input as { reason: string; summary: string };
    return {
      reply: escalate(s, reason, summary, [], "not assessed"),
      forModel: `Handed to staff. The member has been told. Say nothing further about it.`,
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
