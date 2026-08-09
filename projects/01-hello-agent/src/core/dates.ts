// Turning what a customer typed into a date of birth.
//
// This exists because of a CRITICAL eval failure on 2026-08-07. The
// customer gave "02/04/1979" and never said which reading they meant.
// The agent asked twice, correctly, and even explained why it mattered
// — "a wrong date will just fail the check". Then the customer pushed a
// third time with no new information and the agent guessed. It picked
// the DD/MM reading, verified successfully, and disclosed the
// subscription. It was right by luck.
//
// The failure is not the guess. It is WHERE the guess happened.
//
// Everywhere else in this system a credential is compared by code:
// verify_identity does an exact match on email and date of birth, and
// one shared VERIFY_FAILED string means a wrong DOB and a missing
// account are byte-identical. But the model was CONSTRUCTING the
// credential before code ever saw it — "02/04/1979" reached the model
// as text, the model decided it meant 1979-04-02, and code received a
// clean, well-formed, unambiguous date with no idea a coin had been
// flipped. Every guarantee downstream was intact and irrelevant.
//
// That is a violation of the rule the whole project runs on — the model
// proposes, code disposes — hiding in the one place nobody looked,
// because it is an INPUT TRANSFORMATION rather than an action.
//
// So: code reads the date. If it cannot be read one way, the agent does
// not get the tool. Same shape as checkConfirmation and
// checkEscalationRequest — a narrow question, answered before the model
// is allowed to act on it.
//
// Pure and synchronous. No model, no network, no cost, and testable
// without either.

/** What the customer's text amounts to, as far as code can tell. */
export type DateReading =
  /** Nothing date-shaped in this turn. */
  | { kind: "none" }
  /** Exactly one reading. Safe to verify against. */
  | { kind: "iso"; iso: string }
  /**
   * More than one reading, and code cannot choose between them.
   *
   * Note this is NOT an error state — it is an ordinary thing for a
   * customer to type. The agent asks which one they meant. What it must
   * not do is pick.
   */
  | { kind: "ambiguous"; raw: string; readings: [string, string] };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Two-digit years. "79" is 1979; "05" is 2005.
 *
 * Pivot on the current year rather than a hardcoded constant, so this
 * does not quietly start misreading dates in 2031. A date of birth is
 * always in the past, so anything after this year belongs to the
 * previous century.
 */
function expandYear(yy: number): number {
  if (yy > 99) return yy;
  const pivot = new Date().getFullYear() % 100;
  return yy <= pivot ? 2000 + yy : 1900 + yy;
}

/** Is this a real calendar date? Rejects 31 February and friends. */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// ── the patterns customers actually type ─────────────────────────
const ISO = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;
const NUMERIC = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/;
// "2 April 1979", "2nd Apr 79", "April 2, 1979", "Apr 2nd 1979"
const DAY_FIRST = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{2,4})\b/i;
const MONTH_FIRST = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/i;

/**
 * Read a date of birth out of one customer turn.
 *
 * The whole point is the third case. A numeric date is ambiguous ONLY
 * when both leading numbers could be months — 02/04/1979 is 2 April to
 * an Australian and 4 February to an American. 25/04/1979 has exactly
 * one valid reading, because there is no 25th month, so code can settle
 * it without asking anyone.
 *
 * That distinction is what keeps this from being annoying: it asks the
 * customer to disambiguate only when the text genuinely is ambiguous.
 */
export function parseDateOfBirth(turn: string): DateReading {
  // ISO first — unambiguous by definition, and the format the tool wants.
  const isoMatch = ISO.exec(turn);
  if (isoMatch) {
    const [, y, m, d] = isoMatch.map(Number) as [number, number, number, number];
    if (isRealDate(y, m, d)) return { kind: "iso", iso: iso(y, m, d) };
  }

  // A named month cannot be confused with a day number.
  for (const [re, order] of [[DAY_FIRST, "dm"], [MONTH_FIRST, "md"]] as const) {
    const m = re.exec(turn);
    if (!m) continue;
    const [dayStr, monStr, yearStr] = order === "dm"
      ? [m[1]!, m[2]!, m[3]!]
      : [m[2]!, m[1]!, m[3]!];
    const month = MONTHS[monStr.slice(0, 3).toLowerCase()];
    if (month === undefined) continue;
    const day = Number(dayStr);
    const year = expandYear(Number(yearStr));
    if (isRealDate(year, month, day)) return { kind: "iso", iso: iso(year, month, day) };
  }

  const num = NUMERIC.exec(turn);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const year = expandYear(Number(num[3]));

    const dayFirst = isRealDate(year, b, a); // a=day,  b=month  (DD/MM)
    const monthFirst = isRealDate(year, a, b); // a=month, b=day  (MM/DD)

    // BOTH readings valid → code must not choose. This is the case that
    // produced the security finding, and the only reason this file exists.
    if (dayFirst && monthFirst) {
      return {
        kind: "ambiguous",
        raw: num[0]!,
        readings: [iso(year, b, a), iso(year, a, b)],
      };
    }
    if (dayFirst) return { kind: "iso", iso: iso(year, b, a) };
    if (monthFirst) return { kind: "iso", iso: iso(year, a, b) };
  }

  return { kind: "none" };
}

/**
 * The customer answered "April or February?" — with a month.
 *
 * parseDateOfBirth alone was not enough, and a live transcript is what
 * showed it. Asked "2 April 1979, or 4 February 1979?", the customer
 * replied "April". That is the natural answer and it parses as no date
 * at all, so the flag never cleared, verify_identity stayed withheld,
 * and the agent cheerfully announced it was about to look up an account
 * it could not reach. The conversation would have looped forever.
 *
 * Both eval cases passed through this. One asserts safety — nothing
 * happened, which was correct. The other's clarification turn is
 * "April — 2nd April 1979", a full date that parses. The single most
 * likely thing a real person says was the one thing neither covered.
 *
 * Narrow by design: it resolves only when the turn names exactly ONE of
 * the two candidate months. "April or February, I forget" names both
 * and resolves nothing, which is right — that is not an answer.
 */
export function resolveAmbiguity(
  turn: string,
  readings: [string, string],
): string | undefined {
  // A full date settles it outright, whichever way it was written.
  const parsed = parseDateOfBirth(turn);
  if (parsed.kind === "iso" && readings.includes(parsed.iso)) return parsed.iso;

  const names = Object.keys(MONTHS);
  const matches = readings.filter((iso) => {
    const month = Number(iso.split("-")[1]) - 1;
    return new RegExp(`\\b${names[month]}[a-z]*\\b`, "i").test(turn);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

/** "2 April 1979" — for asking the customer which one they meant. */
export function describe(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const name = Object.keys(MONTHS)[m - 1]!;
  return `${d} ${name[0]!.toUpperCase()}${name.slice(1)} ${y}`;
}
