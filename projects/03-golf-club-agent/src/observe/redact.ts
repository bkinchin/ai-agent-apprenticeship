// PII, masked at ingestion.
//
// REDACT ON WRITE, NOT ON READ. A field masked only at display is still
// in the database, still in the backup, and still in the export
// somebody makes for a spreadsheet. The trace store holds everything a
// member said, which is personal data by any reading.
//
// AUSTRALIAN FORMATS, DELIBERATELY. Day 7 measured project 01's PII
// guard at 0/5 on Australian identifiers — it recognised UK phone
// numbers and National Insurance numbers, for a club in Sydney — and
// recorded it as a production blocker. This is the same mistake
// available to make twice.
//
// SHAPE IS PRESERVED. "[phone]" rather than deletion, because a trace
// where a member gave a phone number and one where they did not are
// different facts, and the redacted version has to keep the difference.

import { createHash } from "node:crypto";

export interface Redaction {
  text: string;
  found: string[];
}

const RULES: { label: string; pattern: RegExp }[] = [
  // Before phones: an email can contain digits that look like one.
  { label: "email", pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },

  // Card numbers: 13–19 digits, optionally grouped. Before the phone
  // rules, which would otherwise claim the first ten digits.
  { label: "card", pattern: /\b(?:\d[ -]?){13,19}\b/g },

  // Australian mobiles and landlines: 04xx xxx xxx, 02 xxxx xxxx,
  // +61 4xx xxx xxx. The club is in Sydney.
  { label: "phone", pattern: /\+61[ -]?[2-478](?:[ -]?\d){8}\b/g },
  { label: "phone", pattern: /\b0[2-478](?:[ -]?\d){8}\b/g },

  // Medicare: 10 digits, often written 4-5-1.
  { label: "medicare", pattern: /\b\d{4}[ -]?\d{5}[ -]?\d\b/g },
];

/**
 * Mask personal identifiers. Pure, and never throws.
 *
 * The club's own phone numbers live in contacts.yaml and appear in
 * agent replies constantly — so redaction runs over what the MEMBER
 * said and over tool arguments, not over the club's published contact
 * details. Masking those would make every escalation trace unreadable
 * to protect a number printed on the website.
 */
export function redact(text: string): Redaction {
  const found: string[] = [];
  let out = text;
  for (const { label, pattern } of RULES) {
    out = out.replace(pattern, (m) => {
      // A bare year or a slot id is not a card number.
      if (label === "card" && m.replace(/\D/g, "").length < 13) return m;
      found.push(label);
      return `[${label}]`;
    });
  }
  return { text: out, found: [...new Set(found)] };
}

/** Redact anywhere in a structure, preserving its shape. */
export function redactDeep<T>(value: T): { value: T; found: string[] } {
  const found: string[] = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v);
      found.push(...r.found);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { value: walk(value) as T, found: [...new Set(found)] };
}

/**
 * A stable pseudonym for a member.
 *
 * Not reversible from the trace store alone. The mapping is the tee
 * sheet, which is access-controlled and is where the member's identity
 * legitimately lives — so the trace store never becomes a second copy
 * of the membership list.
 */
export function pseudonym(memberId: string, salt = process.env.TRACE_SALT ?? "golf-club"): string {
  return "m_" + createHash("sha256").update(salt + memberId).digest("hex").slice(0, 10);
}
