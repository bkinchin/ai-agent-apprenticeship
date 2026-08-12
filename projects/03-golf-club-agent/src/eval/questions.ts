// The knowledge golden set.
//
// Twenty questions. The composition is deliberate and matters more than
// the count:
//
//   10  answerable, ordinary          the baseline
//    5  probe a planted defect        stale prose, authority conflicts
//    5  UNANSWERABLE                  the corpus cannot answer them
//
// That last group is the one people leave out, and leaving it out is
// how you optimise for confident invention. An eval containing only
// answerable questions cannot tell a knowledgeable agent from a
// fluent one.
//
// WHAT WE ASSERT. The answer is prose and prose cannot be compared.
// But the SOURCE can:
//
//   1. Did it cite the right document?     deterministic
//   2. Does the answer contain the value?  deterministic-ish
//   3. Is the answer good?                 judge / human
//
// Assertion 1 is the day-7 lesson applied to a fuzzy problem — find the
// checkable thing inside the uncheckable one.

export interface KnowledgeQuestion {
  id: string;
  question: string;
  /**
   * Which source(s) may legitimately answer this. `null` means nothing
   * can. An ARRAY because more than one answer is often right — a
   * question about opening hours may correctly cite either the
   * structured data or the document, and asserting one of them was a
   * test bug, not an agent bug.
   */
  expectSource: string[] | null;
  /** Strings that must appear in a correct answer. */
  expectContains?: string[];
  /**
   * EVERY one of these must be cited — not just one.
   *
   * The assertion for a conflict is "did it surface both sides?", which
   * `expectSource` (any-of) cannot express. Asking instead for a
   * particular form of words was wrong twice.
   */
  expectAllSources?: string[];
  /** Strings that must NOT appear — usually a stale value. */
  expectAbsent?: string[];
  /** True when the only correct behaviour is to decline. */
  expectAbstain?: boolean;
  /** Why this question is in the set. */
  note?: string;
}

export const QUESTIONS: KnowledgeQuestion[] = [
  // ── structured: the answer is a field, not a passage ────────────
  {
    id: "structured/advance-booking",
    question: "How far in advance can I book a tee time?",
    expectSource: ["booking-rules.yaml"],
    expectContains: ["6 weeks", "42"],
    note: "Pure lookup. Should never touch a document.",
  },
  {
    id: "structured/live-bookings",
    question: "How many tee times can I have booked at once?",
    expectSource: ["booking-rules.yaml"],
    expectContains: ["2", "two"],
  },
  {
    id: "structured/guest-monthly",
    question: "How many guests can I bring in a month as a full member?",
    expectSource: ["fees.yaml"],
    expectContains: ["6", "six"],
  },
  {
    id: "structured/cancellation-fee",
    question: "What happens if I cancel two hours before my tee time?",
    expectSource: ["fees.yaml"],
    expectContains: ["15"],
    note: "Requires combining the 24h boundary with the fee. Both structured.",
  },
  {
    id: "structured/buggy-cost",
    question: "How much is a buggy?",
    expectSource: ["fees.yaml"],
    expectContains: ["35"],
  },

  // ── narrative: genuinely needs the document ─────────────────────
  {
    id: "narrative/pace-of-play",
    question: "How long should a fourball take?",
    expectSource: ["course-etiquette.md"],
    // Loosened after three failures that were all phrasing: "3 hours and
    // 15 minutes", "3hr 15", "three and a quarter hours". The fact being
    // tested is the DURATION, not the wording.
    expectContains: ["three hours fifteen", "3 hours 15", "3:15", "3 hr 15", "3h15", "15 minutes", "quarter"],
  },
  {
    id: "narrative/lightning",
    question: "What do I do if I hear the siren on the course?",
    expectSource: ["course-etiquette.md"],
    expectContains: ["leave the course", "shelter"],
    note: "Safety. A wrong answer here is not a customer-service problem.",
  },
  {
    id: "narrative/joining",
    question: "How do I join the club?",
    expectSource: ["membership-handbook.md"],
    expectContains: ["proposer", "sponsor", "second"],
  },
  {
    id: "narrative/resignation",
    question: "If I want to leave, when do I have to tell you?",
    expectSource: ["membership-handbook.md"],
    expectContains: ["1 August", "August"],
  },
  {
    id: "narrative/society-size",
    question: "We're a group of 15 — can we book a society day?",
    expectSource: ["visitors-and-societies.md"],
    expectContains: ["twelve", "12"],
  },

  // ── planted defects ─────────────────────────────────────────────
  {
    id: "defect/stale-guest-fee",
    question: "How much does it cost to bring a guest?",
    expectSource: ["fees.yaml"],
    expectContains: ["20"],
    note: "DEFECT 1. The handbook says $15 and is stale; fees.yaml says $20. " +
      "The single most diagnostic question in the set: quoting $15 as the " +
      "current fee means the structured/unstructured split failed.\n\n" +
      "expectAbsent: ['15'] WAS HERE AND WAS WRONG. It failed the best " +
      "possible answer — 'it is $20; the handbook still says $15 and is out " +
      "of date' — as well as the worst one. The assertion has to be that the " +
      "CURRENT fee is stated, not that a number never appears.",
  },
  {
    id: "defect/denim-ambiguous",
    question: "Can I wear jeans?",
    expectSource: ["dress-code.md", "bar-and-clubhouse.md"],
    expectAllSources: ["dress-code.md", "bar-and-clubhouse.md"],
    note: "DEFECT 2, authority conflict. dress-code.md (Pro Shop) bans denim " +
      "on club premises; bar-and-clubhouse.md (Bar Manager) permits it here. " +
      "NEITHER IS WRONG. Correct behaviour is to surface both and NAME WHO " +
      "DECIDES — not to resolve it.\n\n" +
      "TWO ASSERTION ERRORS BEFORE THIS ONE.\n\n" +
      "First: expectContains ['bar','dress'] passed every run while the " +
      "agent answered 'denim is banned, the only exception is the spike " +
      "bar' — a synthesis it invented, presented as settled, naming " +
      "nobody. The Pro Shop's document contains no such exception.\n\n" +
      "Second: the question was 'can I wear jeans IN THE SPIKE BAR?', " +
      "which is not ambiguous — the bar's own document answers it fully " +
      "and naming an owner would be ceremony. The conflict only surfaces " +
      "on the UNQUALIFIED question, which is what a member actually asks.\n\n" +
      "Third: requiring 'bar manager' in the answer. The agent replies " +
      "'no denim anywhere, except the spike bar', citing both documents " +
      "— a good answer. Naming a decision-maker matters when " +
      "jurisdictions OVERLAP and neither document says which wins. These " +
      "partition cleanly, so there is nothing to decide. The assertion " +
      "that actually tests conflict-surfacing is: were BOTH sources " +
      "cited?",
  },
  {
    id: "defect/closing-time",
    question: "What time does the bar close on a Friday?",
    expectSource: ["bar-and-clubhouse.md", "hours.yaml"],
    expectContains: ["23:00", "11pm", "11 pm"],
    note: "DEFECT 3. The FAQ says the club closes at 22:30 — different " +
      "jurisdiction, different owner.\n\n" +
      "This originally expected bar-and-clubhouse.md ONLY and failed when " +
      "the agent cited hours.yaml — which is the AUTHORITATIVE source for " +
      "opening times. The agent was more right than the test. Both are now " +
      "accepted.",
  },
  {
    id: "defect/junior-eligibility",
    question: "My son is 14 — what does junior membership cost and is he eligible?",
    expectSource: ["fees.yaml"],
    expectContains: ["320"],
    note: "DEFECT 5, partial gap. The FEE exists in YAML; the AGE LIMIT exists " +
      "nowhere. Correct behaviour is to give the fee and flag that eligibility " +
      "is not documented. Half an answer stated confidently is the failure.",
  },
  {
    id: "defect/stale-handicap-system",
    question: "How are competition handicaps calculated?",
    expectSource: ["competition-rules.md"],
    note: "DEFECT 7, staleness. The document is dated 2023 and describes CONGU. " +
      "Correct behaviour is to answer AND flag the date.",
  },

  {
    // FOUND BY HAND, and worse than anything planted on purpose.
    //
    // booking-rules.yaml (authoritative): EVERY Saturday 08:30-11:00.
    // competition-rules.md (STALE, 2023): first and third Saturdays only.
    //
    // The agent used the stale document and told a member they could book
    // on the 2nd and 4th Saturdays — which the authoritative source says
    // are closed. A booking error, on the highest-blast-radius job in the
    // PRD.
    //
    // The mechanism is the interesting part: SPECIFICITY BEAT AUTHORITY.
    // "first and third Saturdays" is detailed and confident; "saturday" is
    // terse. The model trusted the one that sounded better informed —
    // and detail is exactly what goes stale first.
    //
    // The corpus has since been fixed so the window is stated once, in the
    // authoritative place. This case stays forever.
    id: "defect/saturday-competition-window",
    question: "Can I book for Saturday morning?",
    expectSource: ["booking-rules.yaml"],
    expectAbsent: ["first and third"],
  },

  // ── unanswerable: abstention is the only correct answer ─────────
  {
    id: "abstain/dogs",
    question: "Can I bring my dog on the course?",
    expectSource: null,
    expectAbstain: true,
    note: "DEFECT 4. Dogs appear nowhere in the corpus. Any policy the agent " +
      "states is invented — and it will sound entirely plausible.",
  },
  {
    id: "abstain/handicap-index-required",
    question: "What handicap do I need to enter the Club Championship?",
    expectSource: null,
    expectAbstain: true,
    note: "competition-rules.md says who may ENTER (full and country members) " +
      "but sets no handicap limit. Adjacent information makes invention likelier.",
  },
  {
    id: "abstain/electric-bike",
    question: "Is there anywhere to charge an electric bike?",
    expectSource: null,
    expectAbstain: true,
  },
  {
    id: "abstain/green-fee-visitor",
    question: "What's the green fee for a visitor on a Tuesday?",
    expectSource: null,
    expectAbstain: true,
    note: "visitors-and-societies.md says the visitor fee is 'set separately " +
      "and reviewed annually' — and never gives it. The GUEST fee is $20 and " +
      "is a different thing. A tempting wrong answer sits one file away.",
  },
  {
    id: "abstain/wedding",
    question: "Can I hire the clubhouse for a wedding?",
    expectSource: null,
    expectAbstain: true,
    note: "Private hire of the dining room and lounge exists; weddings are " +
      "never mentioned. Tests whether adjacent-but-not-equal counts as an answer.",
  },
];
