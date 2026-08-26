// The handoff package: what the human receives.
//
// This is where escalation is usually botched. The human gets
// "customer needs help", starts from zero, and the member repeats
// everything — at which point the agent has made things WORSE than no
// agent, because it added a wait to a conversation that still happened.
//
// ATTEMPTED IS BUILT FROM THE TOOL TRACE, NOT FROM THE MODEL.
//
// The obvious implementation asks the model to summarise what it tried.
// It will write "I checked availability" whether or not it did — the
// same say/do divergence the PRD identified in the confirmation email,
// arriving in the one artefact a human uses to decide what to do next.
// A handoff package that misreports what was attempted is worse than
// none: the human skips a check that never happened.
//
// So ATTEMPTED is rendered from the calls that actually executed, with
// their real outcomes. NEEDED is the one field that requires judgement,
// and it comes from the trigger's policy rather than from prose.

import type { Reply } from "../core/agent.js";
import { byId, promise, type Trigger, type Urgency } from "./policy.js";

export interface Handoff {
  ref: string;
  raisedAt: string;
  memberId: string;
  triggerId: string;
  source: Trigger["source"];
  urgency: Urgency;
  team: string;
  missing: Trigger["missing"];
  /** One line, from the member's own words where possible. */
  summary: string;
  /** From the trace. What the agent ACTUALLY did, and how it went. */
  attempted: string[];
  /** What the human has to decide or find out. The other valuable field. */
  needed: string;
  sentiment: string;
  transcript: { role: string; text: string }[];
}

/**
 * A reference the member can quote and the club can find.
 *
 * Date-prefixed so a human sorting a folder gets chronological order
 * for free, and short enough to read down a phone.
 */
export function reference(now = new Date()): string {
  const d = now.toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }).replace(/-/g, "");
  return `ESC-${d}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

/** What a human needs to do, per trigger. Policy, not prose. */
const NEEDED: Record<string, string> = {
  asked_for_a_human: "Call the member. They asked to speak to somebody and were not told why not.",
  bereavement:
    "Call personally. Handle any membership or booking changes yourself — do not send them back to the agent.",
  distress: "Call personally. Do not route this back to the agent.",
  refused_and_frustrated:
    "Decide whether to make an exception. The rule was applied correctly; the member disputes it.",
  membership_enquiry: "Talk them through joining, or pass to the club secretary.",
  competition_results: "Send them the result. The agent has no access to competition data.",
  not_in_knowledge_base:
    "Answer the question, and consider whether it belongs in the club's documents.",
  went_in_circles: "The agent could not make progress. Read the transcript and pick it up.",
  repeated_rephrasing:
    "The agent did not understand what they wanted. Read the transcript in their words.",
};

/**
 * Turn traces into something a human reads in ten seconds.
 *
 * Deliberately plain English rather than tool names: the reader is a
 * pro shop manager, not an engineer, and "check_availability({...})"
 * costs them a translation on every line.
 */
function describe(
  tool: string,
  args: Record<string, unknown>,
  detail: string | undefined,
  ok: boolean,
): string | undefined {
  const mark = ok ? "✓" : "✗";
  switch (tool) {
    case "check_availability":
      return `${mark} Checked the tee sheet for ${args.date}${args.from ? ` from ${args.from}` : ""}`;
    case "book_tee_time":
      return `${mark} ${ok ? "Booked" : "Tried to book"} ${args.slotId}` +
        `, ${args.partySize} player(s), ${args.guests} guest(s)` +
        (ok ? "" : ` — ${detail ?? "refused"}`);
    case "cancel_booking":
      return `${mark} ${ok ? "Cancelled" : "Tried to cancel"} ${args.bookingId}`;
    case "list_my_bookings":
      return `${mark} Looked up their current bookings`;
    case "search_knowledge":
      return `${mark} Looked up "${args.question}" in the club's documents`;
    case "remember_preference":
    case "show_what_you_know":
    case "update_what_you_know":
    case "forget_everything":
      return undefined; // housekeeping; not what a human needs to see
    default:
      return undefined;
  }
}

export function buildHandoff(args: {
  memberId: string;
  triggerId: string;
  summary: string;
  replies: Reply[];
  transcript: { role: string; text: string }[];
  sentiment?: string;
  now?: Date;
}): Handoff {
  const t = byId(args.triggerId);
  if (!t) throw new Error(`no such trigger: ${args.triggerId}`);
  const now = args.now ?? new Date();

  const attempted = args.replies
    .filter((r): r is Extract<Reply, { kind: "trace" }> => r.kind === "trace")
    .filter((r) => r.tool !== "(preamble)")
    .map((r) => describe(r.tool, r.args as Record<string, unknown>, r.detail, r.ok))
    .filter((x): x is string => x !== undefined);

  return {
    ref: reference(now),
    raisedAt: now.toISOString(),
    memberId: args.memberId,
    triggerId: t.id,
    source: t.source,
    urgency: t.urgency,
    team: t.team,
    missing: t.missing,
    summary: args.summary,
    attempted:
      attempted.length > 0
        ? attempted
        : ["(nothing — escalated before the agent attempted anything)"],
    needed: NEEDED[t.id] ?? "Read the transcript and pick it up.",
    sentiment: args.sentiment ?? "not assessed",
    transcript: args.transcript,
  };
}

/** What the member is told. Never "an error occurred". */
export function memberMessage(h: Handoff, now = new Date()): string {
  const t = byId(h.triggerId)!;
  return `${t.member_message.trim()} They'll be in touch ${promise(h.urgency, now)}. ` +
    `Your reference is ${h.ref}.`;
}

/** What the human sees. Designed for the first ten seconds. */
export function render(h: Handoff): string {
  const line = "─".repeat(66);
  const wrap = (t: string, indent = 10) =>
    t.replace(new RegExp(`(.{1,${66 - indent}})(\\s|$)`, "g"), `$1\n${" ".repeat(indent)}`).trim();
  return [
    `${h.ref} · URGENCY: ${h.urgency.replace(/_/g, " ").toUpperCase()}`,
    line,
    `MEMBER    ${h.memberId}`,
    `REASON    ${h.source} — ${h.triggerId.replace(/_/g, " ")}`,
    `SUMMARY   ${wrap(h.summary)}`,
    `ATTEMPTED ${h.attempted.map((a, i) => (i === 0 ? a : `          ${a}`)).join("\n")}`,
    `NEEDED    ${wrap(h.needed)}`,
    `SENTIMENT ${h.sentiment}`,
    `MISSING   ${h.missing}   ${h.missing === "none" ? "" : "← for the improvement loop"}`,
    line,
  ].join("\n");
}
