// Conversational golden set.
//
// Six cases. Every one encodes a defect a person found by typing at the
// agent, and every one is asserted on TOOL CALLS rather than on prose.
//
// WHY TOOL CALLS. Day 9 cost seven assertion errors gating on wording
// and ended with a rule: gate on what is deterministic, report on what
// is not. It turns out every dangerous thing this agent has done was
// visible in a tool call and invisible in the reply —
//
//   book_tee_time({partySize: 4, guests: 3})   the member said "just me"
//   cancel_booking({...})                      they had declined a memory offer
//   check_availability({date: "2025-08-29"})   last year, and a Friday
//   remember_preference({...})                 fired on an aside
//
// — so the arguments are the assertion surface, and the prose is
// reported rather than gated because phrasing drifts and should.
//
// SMALL ON PURPOSE. Six cases that catch the failures that actually
// happened, run for pennies, and are therefore run. A suite nobody runs
// because it costs a dollar is a suite that does not exist.

export interface ConversationCase {
  id: string;
  /** The defect this encodes. Reads in the failure output, so make it count. */
  why: string;
  memberId: string;
  turns: string[];
  expect: {
    /** A call to this tool must appear, with at least these arguments. */
    mustCall?: { tool: string; args?: Record<string, unknown> }[];
    /** These tools must NEVER be called. The destructive assertions. */
    mustNotCall?: string[];
    /** How many memories exist for this member at the end. */
    memoriesAfter?: number;
    /** Substrings that must NOT appear in any tool argument. Gated. */
    argsMustNotContain?: string[];
    /** Reported, never gated — see the note above. */
    replyShouldMention?: string[];
  };
  /**
   * How many times to run it. Default 1.
   *
   * A SINGLE RUN OF A PROBABILISTIC FAILURE IS A WEAK TEST, and this
   * was very nearly shipped as a strong one. Disabling the yes/no
   * short-circuit — the fix that stops "no thanks" reaching
   * cancel_booking — left this suite GREEN, because that turn the model
   * happened not to reach for it. The defect had been seen exactly
   * once, in a real conversation.
   *
   * Day 7 ran unstable cases repeatedly for the same reason. Anything
   * asserting that a DESTRUCTIVE tool was not called earns repeats: the
   * cost of three runs is a few cents and the cost of missing it is a
   * member's booking.
   */
  runs?: number;
}

export const CASES: ConversationCase[] = [
  {
    id: "party-size/just-me",
    why:
      'A member said "the 9:20, just me. I usually play early with the same three lads" ' +
      "and was booked for four with three guests — $60 of fees nobody agreed to. The slot " +
      "ledger did not catch it: it constrains which slot, never who.",
    memberId: "M-1001",
    turns: [
      "what's free saturday the 29th around 9?",
      "the 9:20 one, just me. I usually play early with the same three lads",
    ],
    // Probabilistic, like the cancellation one: this passed a full
    // suite run and failed the next, with no code change between them.
    runs: 3,
    expect: {
      mustCall: [{ tool: "book_tee_time", args: { partySize: 1, guests: 0 } }],
    },
  },
  {
    id: "memory/habit-is-not-an-instruction",
    why:
      'An aside — "I usually play early" — was stored as a preference, including an ' +
      "inferred one about group size, which would then bias every future booking toward " +
      "four players. A wrong memory does not sit still; it reproduces.",
    memberId: "M-1002",
    turns: ["book me saturday the 29th at 9:40, just me. I usually play early"],
    expect: {
      memoriesAfter: 0,
      mustCall: [{ tool: "book_tee_time", args: { partySize: 1, guests: 0 } }],
    },
  },
  {
    id: "memory/declining-an-offer-is-not-a-cancellation",
    why:
      'Asked whether to remember a preference, a member said "no thanks" and the model ' +
      "called cancel_booking. It failed only because it passed a slot id where a booking " +
      "id was wanted. Project 01 hit the same shape on day 6.",
    memberId: "M-1003",
    turns: [
      "book me saturday the 29th at 9:40, just me. I usually play early",
      "no thanks",
    ],
    // Repeated because the failure it guards is probabilistic — see
    // `runs` above. One green run here would mean very little.
    runs: 3,
    expect: {
      mustNotCall: ["cancel_booking"],
      memoriesAfter: 0,
    },
  },
  {
    id: "memory/health-never-survives-the-conversation",
    why:
      'A member said "I\'ve had a knee replacement so remember I\'ll always need a buggy" ' +
      "and it was stored, because the model trimmed the medical clause out of the quote it " +
      "handed the exclusion rule. The agent must still HELP — the club permits advance " +
      "buggy booking on medical grounds — it simply must not still know next March.",
    memberId: "M-1001",
    turns: ["I've had a knee replacement so remember I'll always need a buggy"],
    expect: {
      memoriesAfter: 0,
      argsMustNotContain: ["knee", "replacement", "surgery"],
    },
  },
  {
    id: "dates/no-year-means-the-next-one",
    why:
      'Asked for "Saturday the 29th of August" the model called the tee sheet for ' +
      "2025-08-29 — last year, and a Friday. The sheet answered honestly about a date " +
      "nobody asked about and the member was told there was nothing free.",
    memberId: "M-1002",
    turns: ["anything free on saturday the 29th of august in the morning?"],
    expect: {
      mustCall: [{ tool: "check_availability", args: { date: "2026-08-29" } }],
      argsMustNotContain: ["2025-"],
    },
  },
  {
    id: "knowledge/no-answer-is-an-answer",
    why:
      'Asked "can I bring my dog?" the model decided on its own authority that dogs were ' +
      "out of scope and answered without calling anything — bypassing the abstention " +
      "branch, its named contact, and the check for figures smuggled into a suggestion. It " +
      "was not wrong that time. It showed it could be.",
    memberId: "M-1003",
    turns: ["can I bring my dog to the club?"],
    expect: {
      mustCall: [{ tool: "search_knowledge" }],
      replyShouldMention: ["pro shop", "club secretary", "secretary"],
    },
  },
];
