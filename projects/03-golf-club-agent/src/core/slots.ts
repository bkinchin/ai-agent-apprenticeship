// Slot rules that must hold whatever the model believes.
//
// Two guards, both found by a member typing at the agent, and both the
// same shape: read what the MEMBER said or what the CLUB'S DATA says,
// never what the model inferred.

/** A closed window from booking-rules.yaml. */
export interface Closure {
  day: string;
  from: string;
  to: string;
  reason: string;
}

export function closuresFrom(structured: Record<string, unknown>): Closure[] {
  const rules = structured["booking-rules.yaml"] as
    | { tee_sheet_closures?: { windows?: Closure[] } }
    | undefined;
  return rules?.tee_sheet_closures?.windows ?? [];
}

const DAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

/** The weekday of an ISO date, in lower case. UTC, so a date-only string cannot slip a day. */
export function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/**
 * Is this slot inside a window when general booking is shut?
 *
 * THE KNOWLEDGE AND THE ENFORCEMENT LIVED IN DIFFERENT PLACES.
 *
 * Day 9 found the agent telling a member the Saturday competition
 * window was on the wrong weekends, and fixed it IN THE CORPUS — so the
 * knowledge agent now states the rule correctly. Nothing ever enforced
 * it in the booking path. The tee sheet returns 09:00 on a Saturday
 * quite happily, listCompetitions() has never been called by anything,
 * and the agent would explain that the sheet is shut and then book you
 * into it.
 *
 * That is day 9's own highest-blast-radius failure — a member driving
 * to a closed tee sheet — surviving the fix that was supposed to
 * prevent it, because a corpus correction cannot reach a code path.
 */
export function closedFor(slotId: string, closures: Closure[]): Closure | undefined {
  const [date, time] = slotId.split("T");
  if (!date || !time) return undefined;
  const day = weekdayOf(date);
  return closures.find((c) => c.day.toLowerCase() === day && time >= c.from && time < c.to);
}

/**
 * Which weekday, if any, the member named — tolerant of typos.
 *
 * "Can I book for staturday 9am" was resolved by the model to Sunday
 * 30 August. It then asked, which is the right instinct, but it had
 * already queried the wrong date and a member answering "yes" would
 * have been booked a day out.
 *
 * Resolving a weekday name to a date is arithmetic, and day 11 already
 * established the model is unreliable at it — that fix supplied today's
 * date and stopped there, which fixed the YEAR and left the DAY.
 *
 * Edit distance rather than a pattern, because the input class that has
 * found defects all week is ordinary human sloppiness, and you cannot
 * enumerate the ways a word can be mistyped.
 */
export function weekdayNamed(turn: string): string | undefined {
  const words = turn.toLowerCase().match(/[a-z]{4,}/g) ?? [];

  // EXACT MATCHES WIN OUTRIGHT, ACROSS ALL WORDS, BEFORE ANY FUZZINESS.
  //
  // The first version walked the days in order for each word and
  // accepted anything within two edits — so "monday" matched "sunday"
  // (m→s, o→u) because sunday is checked first, and every Monday
  // request was refused as a Sunday. "tuesday" and "thursday" collide
  // the same way.
  //
  // A guard that mangles correct input is worse than no guard: it
  // refused a date the member HAD given, and the model then invented a
  // wrong one to escape.
  for (const w of words) if ((DAYS as readonly string[]).includes(w)) return w;

  // Then the closest day — but only if it is UNAMBIGUOUSLY closest.
  //
  // "sonday" is one edit from both sunday and monday. Guessing there is
  // exactly the failure above with better odds, so it does not guess:
  // an unrecognised weekday leaves the model to resolve it, which is
  // where it started.
  for (const w of words) {
    const scored = DAYS.map((d) => ({ d, n: distance(w, d) })).sort((a, b) => a.n - b.n);
    const [best, next] = scored;
    if (!best || best.n > 2) continue;
    if (Math.abs(w.length - best.d.length) > 2) continue;
    if (next && next.n - best.n < 2) continue; // too close to call
    return best.d;
  }
  return undefined;
}

/** Levenshtein. Small inputs; clarity over cleverness. */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length]!;
}
