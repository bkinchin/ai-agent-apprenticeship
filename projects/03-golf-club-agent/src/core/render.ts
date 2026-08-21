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

const reachable = (c: Contact | undefined): string =>
  c ? `the ${c.name} on ${c.phone} (${c.hours})` : "the pro shop";

/**
 * The member's view of one reply. Never internal state.
 *
 * Returns null when there is nothing for a member to see — a reply that
 * exists only as a diagnostic. The caller decides what to do with
 * silence; this function does not invent something to fill it.
 */
export function memberText(r: Reply, contacts: Record<string, Contact>): string | null {
  if (r.kind === "text") return r.text;

  if (r.kind === "error") {
    // No diagnostic, and no apology theatre. A member wants the next
    // action, and the next action is a person.
    return (
      `Sorry — I can't help with that right now. ` +
      `${reachable(contacts.pro_shop)} will be able to.`
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
  if (r.kind === "error") out.push(`error: ${r.text}`);
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
