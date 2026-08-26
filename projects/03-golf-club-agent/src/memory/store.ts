// Cross-session memory: a database of unverified assertions that gets
// injected into every future prompt.
//
// That sentence is the design brief, not a warning attached to it.
// State is what was SAID and is reliable; memory is what was CONCLUDED
// and can be wrong, stale, or based on a misunderstanding — and then it
// persists and quietly steers every future conversation with a member
// who never agreed to it.
//
// WHY THIS STORE IS SMALL. Four candidates went through one rule —
// "if a system of record knows it, don't remember it, look it up" —
// and three did not survive:
//
//   tee times booked      → the tee sheet. list_my_bookings.
//   guests used           → getMemberAllowance.guestsUsedThisMonth
//   membership expiry     → the CRM (which this project does not have;
//                           an ABSENT system of record is a missing
//                           dependency, not a licence to infer)
//   previous conversations → nothing records this          ← memory
//
// And the fourth, written out as the sentence we would want injected,
// turned out to be a database row:
//
//   "Member xyz raised complaint 123 on May 4th. Escalated to the
//    greenkeeper and still with him."
//     ^ ticket id                     ^ assignee    ^ status
//
// A ticket, with a lifecycle somebody owns. As memory the status field
// freezes at the moment it was written and ages into a lie — the green
// was fixed in June and the agent still says it is outstanding. The
// field you most want is the one memory is worst at.
//
// What was left after removing the ticket was preference, so preference
// is what this stores.

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export type MemoryType = "factual" | "preference" | "episodic";

export interface Memory {
  id: string;
  /** WHOSE. Never null, never optional, never inferred from context. */
  subjectId: string;
  type: MemoryType;
  key: string;
  value: string;
  confidence: number;
  /**
   * WHY WE BELIEVE THIS. Non-negotiable.
   *
   * When a memory turns out to be wrong you must be able to see what
   * was actually said — otherwise correcting it is guesswork and
   * showing a member why you think something is impossible. It is also
   * the difference between "we think you prefer mornings" and "you said
   * so on 3 March", which is the difference between useful and creepy.
   */
  source: { sessionId: string; turnIndex: number; quote: string };
  createdAt: string;
  lastConfirmedAt: string;
  /** Expiry is a FEATURE. See ttlDays. */
  expiresAt: string;
}

/**
 * How long a belief stays a belief.
 *
 * Decay is not a cleanup job. A preference stated three years ago is a
 * guess presented as knowledge, and the member has no idea it is still
 * being applied. Letting it lapse is the honest default; the member can
 * always say it again, and if they do it comes back with a fresh date.
 */
const ttlDays: Record<MemoryType, number> = {
  preference: 365,
  episodic: 180,
  factual: 3650, // until contradicted, in practice
};

// ── the exclusion list ──────────────────────────────────────────
//
// ENFORCED IN CODE, AT WRITE TIME. Asking a model not to extract
// something is a request; refusing to store it is a guarantee, and the
// difference matters most for exactly the categories on this list.
//
// The subtlety: this is NOT a list of things the agent may not discuss.
// The club's FAQ says buggies may be booked in advance on medical
// grounds, so a member WILL say "I've had a knee replacement" and the
// agent must handle it warmly and book the buggy. It simply must not
// still know next March. An exclusion list is about what survives the
// conversation, not about what can be said in it.

interface Rule {
  name: string;
  test: (t: string) => boolean;
}

const has = (re: RegExp) => (t: string) => re.test(t);

const EXCLUDED: Rule[] = [
  {
    name: "health",
    test: has(
      /\b(injur\w*|surger\w*|operation|knee|hip|shoulder|back pain|cancer|ill(ness)?|disab\w+|medication|medical|physio|recover\w+|heart|diabet\w+|arthrit\w+|pregnan\w+)\b/i),
  },
  {
    name: "financial hardship",
    test: has(/\b(afford|struggl\w+|redundan\w+|unemployed|hardship|can'?t pay|money'?s tight|broke)\b/i),
  },
  {
    name: "relationship change",
    test: has(/\b(divorc\w+|separat\w+|widow\w*|bereave\w+|passed away|died|funeral|split up)\b/i),
  },
  {
    name: "third party",
    // Another member's name or business is not this member's memory to
    // carry, and storing it under this subject is a leak with extra
    // steps.
    test: has(/\b(my (wife|husband|partner|son|daughter|friend)'?s? (handicap|health|membership|number))\b/i),
  },
  {
    // NOT ONE REGEX. "complained about the rude barman" and "the barman
    // was rude" put the same two ideas in opposite orders, and a single
    // pattern can only have one of them. Two independent conditions
    // have no order to get wrong.
    name: "named staff complaint",
    test: (t) =>
      /\b(rude|incompetent|useless|unhelpful|obnoxious|abusive|complain\w*)\b/i.test(t) &&
      /\b(staff|the pro|manager|greenkeeper|barman|bar ?staff|secretary|receptionist)\b/i.test(t),
  },
];

/**
 * Which rule blocks this, if any. Pure — testable with no database.
 *
 * A BACKSTOP, NOT THE PRIMARY DEFENCE, and the difference matters.
 * Patterns miss phrasings — this list failed "the barman was rude to
 * me" until the rule stopped being one regex, and there will be others
 * nobody has thought of. Day 9 put it plainly: you cannot enumerate the
 * ways a sentence can be phrased.
 *
 * What actually keeps the excluded categories out is the WRITE POLICY:
 * memory is written only when a member explicitly asks for it, so the
 * store is never fed the open-ended text where these categories live.
 * This list catches the case where they say "remember that..." and then
 * say something they should not have to think twice about saying.
 */
export function excludedBy(text: string): string | undefined {
  return EXCLUDED.find((r) => r.test(text))?.name;
}

// ── the store ───────────────────────────────────────────────────

const DEFAULT_PATH = process.env.MEMORY_DB ?? ".memory.db";

export class MemoryStore {
  private db: DatabaseSync;

  constructor(path = DEFAULT_PATH) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        subjectId TEXT NOT NULL,
        type TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL NOT NULL,
        sessionId TEXT NOT NULL,
        turnIndex INTEGER NOT NULL,
        quote TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        lastConfirmedAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_subject ON memories(subjectId);
    `);
  }

  /**
   * Write a belief.
   *
   * Returns why it was refused, or the stored memory. Refusal is a
   * normal outcome rather than an error — most write attempts SHOULD
   * be refused, and a store that throws on the common case teaches
   * callers to wrap it in a try/catch and stop reading the reason.
   */
  remember(
    subjectId: string,
    m: {
      type: MemoryType;
      key: string;
      value: string;
      confidence: number;
      source: { sessionId: string; turnIndex: number; quote: string };
    },
    now = new Date(),
  ): { stored: Memory } | { refused: string } {
    // The QUOTE is checked, not just the value. A sanitised value with
    // a sensitive quote behind it still puts the sensitive text in the
    // database, and the quote is the field we promise to show people.
    const blocked = excludedBy(m.value) ?? excludedBy(m.source.quote) ?? excludedBy(m.key);
    if (blocked) return { refused: blocked };

    const created = now.toISOString();
    const expires = new Date(now.getTime() + ttlDays[m.type] * 864e5).toISOString();

    // CONTRADICTION: last write wins, for preferences only.
    //
    // Chosen over keeping both because a preference is a statement
    // about the present — "I'd rather have mornings now" replaces the
    // old view rather than competing with it, and showing a model two
    // conflicting preferences makes it ask a question the member has
    // already answered. The old row is deleted rather than archived
    // because an archive nobody reads is a GDPR liability with no
    // upside.
    //
    // This would be the WRONG strategy for factual or episodic memory,
    // where two accounts of the same event are genuinely informative.
    // Recorded here rather than generalised.
    const existing = this.db
      .prepare(`SELECT id FROM memories WHERE subjectId = ? AND key = ?`)
      .all(subjectId, m.key) as { id: string }[];
    for (const row of existing) {
      this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(row.id);
    }

    const stored: Memory = {
      id: randomUUID(),
      subjectId,
      ...m,
      createdAt: created,
      lastConfirmedAt: created,
      expiresAt: expires,
    };

    this.db
      .prepare(
        `INSERT INTO memories
         (id, subjectId, type, key, value, confidence, sessionId, turnIndex, quote,
          createdAt, lastConfirmedAt, expiresAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        stored.id, subjectId, stored.type, stored.key, stored.value, stored.confidence,
        stored.source.sessionId, stored.source.turnIndex, stored.source.quote,
        stored.createdAt, stored.lastConfirmedAt, stored.expiresAt,
      );

    return { stored };
  }

  /**
   * Everything believed about ONE subject.
   *
   * THERE IS NO FUNCTION HERE THAT READS WITHOUT A subjectId. Not a
   * convenience one, not a debug one. Cross-member leakage is the
   * catastrophic failure of a memory system — one member told about
   * another — and the cheapest defence is that the unscoped query does
   * not exist to be called by accident.
   *
   * Expired rows are filtered on read rather than deleted on a
   * schedule, so decay works even if nothing ever sweeps.
   */
  recall(subjectId: string, opts: { limit?: number; now?: Date } = {}): Memory[] {
    const now = (opts.now ?? new Date()).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE subjectId = ? AND expiresAt > ?
         ORDER BY confidence DESC, lastConfirmedAt DESC
         LIMIT ?`,
      )
      .all(subjectId, now, opts.limit ?? 8) as Record<string, string | number>[];

    return rows.map((r) => ({
      id: String(r.id),
      subjectId: String(r.subjectId),
      type: String(r.type) as MemoryType,
      key: String(r.key),
      value: String(r.value),
      confidence: Number(r.confidence),
      source: {
        sessionId: String(r.sessionId),
        turnIndex: Number(r.turnIndex),
        quote: String(r.quote),
      },
      createdAt: String(r.createdAt),
      lastConfirmedAt: String(r.lastConfirmedAt),
      expiresAt: String(r.expiresAt),
    }));
  }

  /**
   * Correct one memory. Scoped, so a member cannot edit another's.
   *
   * The correction re-dates the memory: a member bothering to fix it is
   * the strongest confirmation signal available, stronger than the
   * inference that created it.
   */
  correct(subjectId: string, id: string, value: string, now = new Date()): boolean {
    const blocked = excludedBy(value);
    if (blocked) return false;
    const r = this.db
      .prepare(
        `UPDATE memories SET value = ?, lastConfirmedAt = ?, confidence = 1.0
         WHERE id = ? AND subjectId = ?`,
      )
      .run(value, now.toISOString(), id, subjectId);
    return Number(r.changes) > 0;
  }

  /** Delete one. Scoped. */
  forget(subjectId: string, id: string): boolean {
    const r = this.db.prepare(`DELETE FROM memories WHERE id = ? AND subjectId = ?`).run(id, subjectId);
    return Number(r.changes) > 0;
  }

  /** Erasure. Returns how many rows went, so the caller can say so. */
  forgetAll(subjectId: string): number {
    const r = this.db.prepare(`DELETE FROM memories WHERE subjectId = ?`).run(subjectId);
    return Number(r.changes);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Did the member actually ASK us to remember this?
 *
 * "Explicit only" was written in the remember_preference tool
 * description — "never call this because a preference seemed implied"
 * — and the model ignored it. Told "I usually play early with the same
 * three lads", an aside inside a booking request, it stored two
 * preferences, one of them inferred:
 *
 *   group_size = "4 players: member plus 3 regular mates"
 *
 * That belief is then injected into every future conversation and would
 * bias later bookings towards four players — manufacturing the very
 * defect the booking confirmation had just been changed to detect. A
 * wrong memory does not sit still being wrong; it reproduces.
 *
 * A tool description is a request. This is the guarantee, and it turns
 * on a real distinction rather than on keyword luck:
 *
 *   STANDING INSTRUCTION   remember / from now on / always / I'd rather
 *   DESCRIPTION OF HABIT   usually / normally / tend to / generally
 *
 * The second kind is a member describing themselves, not asking us to
 * act on it forever. Refusing it loses nothing — the model can ask,
 * which is the "human-confirmed" policy the curriculum lists fourth,
 * arrived at by closing the hole in the first.
 */
const STANDING =
  /\b(remember|don'?t forget|make a note|note that|bear in mind|keep in mind|from now on|in future|going forward|always|never|i'?d (rather|prefer)|i prefer|my preference)\b/i;

/**
 * A bare affirmative. NOT sufficient on its own — see isAffirmative.
 *
 * Treating "yes" as a general unlock was the first attempt and it
 * failed on its first outing: the agent asked about a tee time, the
 * member said "yes please", and the model spent that yes on a memory.
 * An affirmative only ever commits a draft the CALLER is holding.
 */
const AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|ok(ay)?|please do|go on|do that|that'?s right)\b/i;

/** The member issued a standing instruction — store it without asking. */
export function statedAsStanding(memberTurn: string): boolean {
  return STANDING.test(memberTurn.trim());
}

/**
 * A bare yes. On its own this authorises NOTHING — the caller must
 * also be holding a draft it proposed on the previous turn, or the yes
 * belonged to some other question.
 */
export function isAffirmative(memberTurn: string): boolean {
  return AFFIRMATIVE.test(memberTurn.trim());
}
