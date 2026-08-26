// The club's rules, read from the club's rulebook.
//
// WHY THIS FILE EXISTS. A member asked to book Saturday 9am and was
// booked, straight into the club competition window. The obvious
// reading was that one rule had been overlooked. An audit said
// otherwise:
//
//   max_days_ahead: 42        42 HARDCODED in dates logic
//   max_live_per_member: 2    taken from the SUPPLIER's response
//   min_notice_hours: 1       enforced NOWHERE  (booked 10 min ahead)
//   guests.max_per_booking: 2 enforced NOWHERE  (booked 4 in one go)
//   guests.max_per_month: 6   taken from the SUPPLIER's response
//   tee_sheet_closures        enforced NOWHERE  (the reported bug)
//
// Three of six unenforced, one duplicated, two delegated. The booking
// path had never read booking-rules.yaml at all.
//
// The cause is a seam, not an oversight. booking-rules.yaml was written
// on day 9 for the KNOWLEDGE agent; the tools were written on day 10
// against the tee sheet's API. Each was correct about its own half, and
// nobody asked the question that joins them:
//
//   DOES THE SUPPLIER KNOW THE CLUB'S RULES?
//
// For a Google Sheet that staff edit all day, obviously not. Day 9's
// note even says so — in a document about retrieval, where the person
// writing the booking tools had no reason to look.
//
// So: one place that reads the rulebook, and the supplier's numbers are
// CROSS-CHECKED rather than trusted. A rule the club writes down and
// the agent does not enforce is worse than no rule, because everyone
// believes it is being applied.

import { closedFor, weekdayOf, type Closure } from "./slots.js";

export interface ClubRules {
  maxDaysAhead: number;
  maxLivePerMember: number;
  minNoticeHours: number;
  maxGuestsPerBooking: number;
  maxGuestsPerMonth: number;
  /**
   * Guests per month BY MEMBERSHIP CATEGORY, from fees.yaml.
   *
   * booking-rules.yaml carries a flat 6, which is the full-member
   * figure. fees.yaml is per category and is the more precise of the
   * two — one rule, two places, and the flat one loses.
   */
  guestsPerMonthByCategory: Record<string, number>;
  closures: Closure[];
}

export function rulesFrom(structured: Record<string, unknown>): ClubRules {
  const r = structured["booking-rules.yaml"] as
    | {
        booking?: { max_days_ahead?: number; max_live_per_member?: number; min_notice_hours?: number };
        guests?: { max_per_booking?: number; max_per_calendar_month?: number };
        tee_sheet_closures?: { windows?: Closure[] };
      }
    | undefined;
  const fees = structured["fees.yaml"] as
    | { membership?: Record<string, { guests_per_month?: number }> }
    | undefined;
  const byCategory: Record<string, number> = {};
  for (const [cat, v] of Object.entries(fees?.membership ?? {})) {
    if (v && typeof v === "object" && typeof v.guests_per_month === "number") {
      byCategory[cat] = v.guests_per_month;
    }
  }

  return {
    guestsPerMonthByCategory: byCategory,
    maxDaysAhead: r?.booking?.max_days_ahead ?? 42,
    maxLivePerMember: r?.booking?.max_live_per_member ?? 2,
    minNoticeHours: r?.booking?.min_notice_hours ?? 1,
    maxGuestsPerBooking: r?.guests?.max_per_booking ?? 2,
    maxGuestsPerMonth: r?.guests?.max_per_calendar_month ?? 6,
    closures: r?.tee_sheet_closures?.windows ?? [],
  };
}

export interface Violation {
  /** For the member, and for the model to relay. */
  member: string;
  /** For the model, so it knows what to do next. */
  instruction: string;
}

/**
 * Every club rule that a single booking can break. Pure.
 *
 * Checked BEFORE the tee sheet is touched, because a rule the supplier
 * does not know is a rule the supplier will happily let you break.
 */
export function checkBooking(
  args: { slotId: string; guests: number },
  rules: ClubRules,
  now = new Date(),
): Violation | undefined {
  const [date, time] = args.slotId.split("T");
  if (!date || !time) {
    return { member: "That doesn't look like a valid time.", instruction: `Malformed slotId.` };
  }

  const shut = closedFor(args.slotId, rules.closures);
  if (shut) {
    return {
      member:
        `the tee sheet is closed ${shut.from}–${shut.to} on a ${shut.day} for the ` +
        `${shut.reason.toLowerCase()}`,
      instruction:
        `Refused: inside the ${shut.reason} window (${shut.day} ${shut.from}–${shut.to}). ` +
        `Offer a time outside it.`,
    };
  }

  if (args.guests > rules.maxGuestsPerBooking) {
    // Booked four guests in one go while the rule said two. Not caught
    // by the allowance check, which only looks at the monthly total —
    // so a member with headroom could bring five, be charged for five,
    // and have three turned away at the first tee.
    return {
      member: `you can sign in ${rules.maxGuestsPerBooking} guests on one booking`,
      instruction:
        `Refused: ${args.guests} guests, and the club allows ${rules.maxGuestsPerBooking} ` +
        `per booking. Ask whether they want two bookings, or fewer guests.`,
    };
  }

  const tee = new Date(`${date}T${time}:00+10:00`);
  const hoursAway = (tee.getTime() - now.getTime()) / 3600e3;
  if (hoursAway < rules.minNoticeHours) {
    return {
      member:
        hoursAway < 0
          ? `that time has already passed`
          : `the club needs at least ${rules.minNoticeHours} hour's notice`,
      instruction: `Refused: only ${hoursAway.toFixed(1)}h away; the club needs ${rules.minNoticeHours}h.`,
    };
  }

  const daysAway = (tee.getTime() - now.getTime()) / 864e5;
  if (daysAway > rules.maxDaysAhead) {
    return {
      member: `bookings open ${rules.maxDaysAhead} days ahead`,
      instruction: `Refused: ${Math.round(daysAway)} days away; the limit is ${rules.maxDaysAhead}.`,
    };
  }

  void weekdayOf;
  return undefined;
}

/**
 * The stricter of what the club says and what the supplier says.
 *
 * The allowance endpoint returns its own limits and the booking path
 * used them without question. If the sheet is edited to allow three
 * live bookings, the club's rule quietly stops applying — and nobody
 * finds out, because the agent's behaviour still looks correct.
 *
 * The rulebook is the policy; the supplier is a data store that happens
 * to carry a copy. Disagreement is surfaced rather than resolved
 * silently, because it means one of the two is wrong and somebody
 * should know which.
 */
export function reconcileLimit(
  clubValue: number,
  supplierValue: number,
  label: string,
): { limit: number; disagreement?: string } {
  if (clubValue === supplierValue) return { limit: clubValue };
  return {
    limit: Math.min(clubValue, supplierValue),
    disagreement:
      `${label}: the club's rules say ${clubValue}, the tee sheet says ${supplierValue}. ` +
      `Applying ${Math.min(clubValue, supplierValue)}.`,
  };
}
