// What the member reads.
//
// Separated from the agent and from the REPL because it kept leaking.
// In one session a member-facing surface showed all of this:
//
//   the agent is unavailable — Connection error.   a Node exception
//   [declined]                                     a debug status label
//   → pro shop: Ask the Pro Shop Manager...        a raw routing field
//   ⚑ bad citation — fees.yaml: ...                an internal detector
//
// Day 10 recorded the gap — "internal and member-facing text want
// separating" — and four days later it had surfaced three times,
// because a written-down lesson is not a control. Only code is.
//
// The cause is not carelessness. `chat.ts` inherited its display from
// `ask.ts`, and `ask.ts` is a DEVELOPER tool whose whole job was to make
// the abstention branch visible. The debug view was correct for the
// program it was written for and became wrong the moment a member was
// on the other end. That is how diagnostics leak: not by being written
// into the member's message, but by the member arriving at a surface
// that was already printing them.
//
// So there are two renderers over one structured object, and the agent
// returns objects rather than strings precisely so both can exist.
//
// NOTE ON WHO COMPOSES. Everything here is assembled BY CODE from
// verified fields. The only model-written prose that reaches a member
// is the knowledge agent's `answer`, which carries citations that code
// has already checked. The abstention branch does not pass through the
// model's `reason` or `suggestion` at all — both are written for a
// developer, and neither is needed once the contact details are real.

import type { Reply } from "./agent.js";

/** One role a member can be routed to. Shape of `structured/contacts.yaml`. */
export interface Contact {
  name: string;
  phone: string;
  email: string;
  hours: string;
  handles: string;
}

/**
 * Contacts, from the corpus rather than from source.
 *
 * THE PHONE NUMBER USED TO BE A STRING LITERAL IN chat.ts. A club fact,
 * invented by me, printed to a member — the exact failure the citation
 * machinery exists to prevent, sitting in the one place nobody thought
 * to check. Every fact a member reads comes from the corpus, and "every"
 * includes the ones in the error path.
 */
export function contactsFrom(structured: Record<string, unknown>): Record<string, Contact> {
  const file = structured["contacts.yaml"] as { contacts?: Record<string, Contact> } | undefined;
  return file?.contacts ?? {};
}

/**
 * The guest fee, from fees.yaml.
 *
 * Read rather than hardcoded for the same reason the phone number is:
 * every club fact a member reads comes from the corpus. It was raised
 * from $15 to $20 in April and several documents still say $15, which
 * is precisely why a literal in source would be wrong within months.
 */
export function guestFeeFrom(structured: Record<string, unknown>): number | undefined {
  const fees = structured["fees.yaml"] as { guest?: { green_fee?: number } } | undefined;
  return fees?.guest?.green_fee;
}

/**
 * "2026-08-23" → "Saturday 23 August".
 *
 * UTC throughout, deliberately. Constructing a local Date from a
 * date-only string lands on midnight local, and any timezone west of
 * the parse shifts the weekday by one — an agent in Sydney telling a
 * member "Friday" for a Saturday booking. A date with no time in it
 * has no timezone; treating it as if it did is how the day slips.
 */
function niceDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;

/** Capitalise a fragment that has ended up starting a sentence. */
const sentence = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

const reachable = (c: Contact | undefined): string =>
  c ? `the ${c.name} on ${c.phone} (${c.hours})` : "the pro shop";

/**
 * The member's view of one reply. Never internal state.
 *
 * Returns null when there is nothing for a member to see — a reply that
 * exists only as a diagnostic. The caller decides what to do with
 * silence; this function does not invent something to fill it.
 */
export function memberText(
  r: Reply,
  contacts: Record<string, Contact>,
  guestFee?: number,
): string | null {
  if (r.kind === "trace") return null; // developer channel. never a member's.
  if (r.kind === "text" || r.kind === "aside") return r.text;

  if (r.kind === "error") {
    // No diagnostic, and no apology theatre. A member wants the next
    // action, and the next action is a person.
    return (
      `Sorry — I can't help with that right now. ` +
      `${sentence(reachable(contacts.pro_shop))} will be able to.`
    );
  }

  // ── writes, reported from the record ──────────────────────────
  //
  // Every fact in these sentences comes from what the tee sheet
  // returned, never from what the model said it was doing. That is the
  // PRD's founding requirement, and the reason the confirmation email
  // must be generated the same way.

  if (r.kind === "booking") {
    const o = r.outcome;
    if (o.status === "booked") {
      const date = o.slotId.split("T")[0] ?? "";
      // SAY WHO, NOT JUST WHEN.
      //
      // The first version confirmed the date, the time and a reference,
      // and said nothing about the party. A member who asked for "just
      // me" and was booked for four with three guests read "You're
      // booked — Saturday 29 August at 09:20" and would have found out
      // about the other three, and the $60, at the first tee.
      //
      // The confirmation must name every field the member could
      // disagree with. Those are exactly the fields that cost money and
      // exactly the ones the model gets wrong.
      const who =
        o.guests > 0
          ? `${o.partySize} players including ${o.guests} guest${o.guests > 1 ? "s" : ""}`
          : o.partySize > 1
            ? `${o.partySize} players`
            : `just you`;
      const fee =
        o.guests > 0 && guestFee
          ? ` Guest fees come to $${o.guests * guestFee} on your account.`
          : "";
      // SAY SO WHEN IT IS NOT WHAT THEY ASKED FOR.
      //
      // Silently booking 09:50 for a member who said 09:40 is truthful
      // and still wrong: they have to notice the discrepancy
      // themselves, in a sentence that reads like a confirmation of
      // what they wanted.
      const swapped =
        r.requested && r.requested !== o.time
          ? `${r.requested} had gone, so I've put you in at ${o.time} — `
          : "";
      return (
        `${swapped ? swapped : `You're booked — `}` +
        `${swapped ? `${niceDate(date)}` : `${niceDate(date)} at ${o.time}`}` +
        `${swapped ? ` — ${who}` : `, ${who}`}.${fee} ` +
        `Your reference is ${o.bookingId}.`
      );
    }
    if (o.status === "slot_taken") {
      // A conflict is a conversation, not an exception. And it says WHY:
      // "someone's just taken it" tells the member this was bad luck
      // seconds ago, not a rule they have fallen foul of.
      if (o.alternatives.length === 0) {
        return `Someone's just taken that one, I'm afraid, and there's nothing else free that day.`;
      }
      return (
        `Someone's just taken that one, I'm afraid. ` +
        `I can do ${list(o.alternatives.map((a) => a.time))} — any good?`
      );
    }
    if (o.status === "not_permitted") return `I can't book that — ${o.reason}.`;
    // `reason` is an engineer's string and never reaches the member.
    // What reaches them is which of two situations they are in.
    return o.transient
      ? `I can't reach the tee sheet at the moment, so I haven't booked anything. ` +
        `${sentence(reachable(contacts.pro_shop))} can do it directly.`
      : `Something isn't right with your membership record, so I haven't booked anything. ` +
        `${sentence(reachable(contacts.pro_shop))} can sort that out.`;
  }

  if (r.kind === "cancelled") {
    return r.ok
      ? `That's cancelled.`
      : `I couldn't cancel that — ${reachable(contacts.pro_shop)} can sort it out.`;
  }

  if (r.kind === "bookings") {
    if (r.bookings.length === 0) return `You've nothing booked at the moment.`;
    const lines = r.bookings.map((b) => {
      const [date, time] = b.slotId.split("T");
      const guests = b.guests > 0 ? ` (${b.guests} guest${b.guests > 1 ? "s" : ""})` : "";
      return `  · ${niceDate(date ?? "")} at ${time}${guests} — ${b.id}`;
    });
    return `You've got ${r.bookings.length === 1 ? "one booking" : `${r.bookings.length} bookings`}:\n${lines.join("\n")}`;
  }

  if (r.kind === "memories") {
    // WHAT MAKES THIS HELPFUL RATHER THAN UNSETTLING.
    //
    // Not the list — the PROVENANCE. "We think you prefer mornings" is
    // surveillance; "you told us on 3 March: I'd always rather play
    // before nine" is a receipt. The member can see we did not deduce
    // it, work out why it is there, and correct it knowing what they
    // are correcting.
    //
    // Also why the whole list is shown rather than a summary: a
    // summary of what you know about someone, given to that person, is
    // a way of not telling them.
    if (r.memories.length === 0) {
      return `I don't know anything about you beyond what's in this conversation — I only remember things you ask me to.`;
    }
    const items = r.memories.map((m) => {
      const when = new Date(m.lastConfirmedAt).toLocaleDateString("en-AU", {
        day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney",
      });
      return `  · ${m.value}\n    you said on ${when}: "${m.source.quote}"`;
    });
    return (
      `Here's everything I've got written down about you:\n\n${items.join("\n\n")}\n\n` +
      `Tell me if any of it's wrong, or say the word and I'll delete the lot.`
    );
  }

  const a = r.answer;

  if (a.status === "not_in_knowledge_base") {
    // "[declined]" is a status. This is a sentence.
    const who = contacts[a.contact] ?? contacts.club_secretary;
    return (
      `I don't have anything on that, I'm afraid — ` +
      `the ${who?.name ?? "Club Secretary"} will know. ` +
      `You can reach them on ${who?.phone ?? "the club number"}, ${who?.hours ?? "during office hours"}.`
    );
  }

  // The verified answer, unmodified. This is the one piece of
  // model-written prose a member sees, and it is the piece that has
  // citations code has already checked.
  let text = a.answer;

  // STALENESS IS FOR THE MEMBER, CITATIONS ARE FOR US.
  //
  // Day 9 found that a stale source never reached the member and moved
  // the warning from the prompt into code. Dropping it here would undo
  // that fix in the name of tidying up — a member acting on an out-of-
  // date fee is the thing it was built to prevent. Sources themselves
  // stay in the developer view: "▸ fees.yaml" means nothing to a member.
  if (r.staleSources.length > 0) {
    text +=
      `\n\nWorth confirming that one with ${reachable(contacts.pro_shop)} — ` +
      `the club's note on it is overdue a review.`;
  }

  return text;
}

/**
 * The developer's view: everything the member does not see.
 *
 * NOT hidden by default. Fourteen of week one's twenty-two defects were
 * found by a person reading output, so a REPL that shows only the member
 * view would be a worse tool than the one it replaced. The point was
 * never to hide the diagnostics — it was to stop them being IN the
 * member's message.
 */
export function devLines(r: Reply): string[] {
  const out: string[] = [];
  if (r.kind === "trace") {
    out.push(`→ ${r.tool}(${JSON.stringify(r.args)})`);
    out.push(`  ${r.note}`);
    return out;
  }
  if (r.kind === "error") out.push(`error: ${r.text}`);
  if (r.kind === "booking") out.push(`tee sheet: ${JSON.stringify(r.outcome)}`);
  if (r.kind === "cancelled") out.push(`tee sheet: cancelled=${r.ok}`);
  if (r.kind === "bookings") out.push(`tee sheet: ${r.bookings.length} booking(s)`);
  if (r.kind === "memories") {
    for (const m of r.memories) out.push(`mem ${m.key}=${m.value} conf=${m.confidence} exp=${m.expiresAt.slice(0, 10)}`);
    if (r.memories.length === 0) out.push(`mem: none`);
  }
  if (r.kind !== "verbatim") return out;

  const a = r.answer;
  if (a.status === "not_in_knowledge_base") {
    out.push(`declined: ${a.reason}`);
    out.push(`route: ${a.contact} — ${a.suggestion}`);
    if (/\d/.test(a.suggestion)) out.push(`⚑ suggestion contains a figure — uncited`);
    return out;
  }

  for (const c of a.citations) {
    out.push(`▸ ${c.source}  "${c.quote.slice(0, 80).replace(/\s+/g, " ")}"`);
  }
  if (a.citations.length === 0) out.push(`⚑ ANSWERED WITH NO CITATION`);
  for (const s of r.staleSources) out.push(`⚑ ${s.id} overdue review ${s.reviewDue}`);
  for (const b of r.badCitations) out.push(`⚑ bad citation — ${b.source}: ${b.why}`);
  return out;
}
