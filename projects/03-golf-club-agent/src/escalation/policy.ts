// Escalation: triggers, detection, and what the member is told.
//
// ESCALATION IS A PRODUCT SURFACE, NOT AN ERROR PATH. A fast,
// well-informed handoff is a good outcome; a slow context-free one
// after five failed attempts is the bad one. A ZERO escalation rate is
// a red flag — it means the agent is attempting things it should not.
//
// DETECTION MATCHES THE TRIGGER'S NATURE:
//
//   "can I speak to someone?"      a PHRASE      → code
//   "my husband died"              a PHRASE      → code, BEFORE the model
//   same tool, same args, 3×       a COUNT       → code
//   "this is outside what I know"  a JUDGEMENT   → the model, via a tool
//
// The two emotional triggers short-circuit before any inference. Not
// for cost — because an LLM should not be composing a first response to
// a bereavement, however good it would be at it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export type Source = "requested" | "emotional" | "policy" | "capability" | "structural";
export type Urgency = "immediate" | "same_day" | "next_working_day";
/** What the agent LACKED. Sorted by volume, this field is the roadmap. */
export type Missing = "none" | "knowledge" | "tool" | "policy" | "judgement" | "out_of_scope";

export interface Trigger {
  id: string;
  source: Source;
  urgency: Urgency;
  team: string;
  missing: Missing;
  member_message: string;
}

interface Policy {
  urgency: Record<Urgency, { tell_member: string; tell_member_in_hours: string }>;
  triggers: Trigger[];
}

const ROOT = join(import.meta.dirname, "..", "..");
const policy = parse(
  readFileSync(join(ROOT, "structured", "escalation.yaml"), "utf8"),
) as Policy;

export const triggers = policy.triggers;
export const byId = (id: string): Trigger | undefined => triggers.find((t) => t.id === id);

/**
 * What we promise the member, given the clock.
 *
 * URGENCY IS A PROMISE, NOT A QUEUE PRIORITY. The club is staffed
 * 08:00–16:30 and the PRD's whole premise is out-of-hours demand, so
 * most escalations are raised when nobody is there. "Urgently" as a
 * priority the member cannot see is a claim they will measure against
 * eleven hours of silence.
 */
export function promise(u: Urgency, now = new Date()): string {
  const sydney = now.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    hour12: false,
  });
  const hour = Number(sydney.slice(0, 2));
  const open = hour >= 8 && hour < 16;
  return open ? policy.urgency[u].tell_member_in_hours : policy.urgency[u].tell_member;
}

// ── phrase detection ────────────────────────────────────────────

/**
 * "Get me a person." ALWAYS HONOURED, NEVER NEGOTIATED.
 *
 * An agent that argues with this generates complaints out of all
 * proportion to its accuracy, and it is the cheapest trigger to
 * implement. Deliberately broad: a false positive costs one unnecessary
 * handoff, which is a rounding error against the cost of refusing.
 */
const HUMAN =
  /\b(speak|talk|chat)\s+(to|with)\s+(a\s+)?(human|person|someone|somebody|staff|manager|the pro|real person)\b|\b(get|put)\s+me\s+(through\s+)?(to\s+)?(a\s+)?(human|person|someone|manager)\b|\bhuman\s+(please|now)\b|\breal\s+person\b|\bstop\s+(being\s+)?(a\s+)?(bot|robot)\b|\bare\s+you\s+a\s+(bot|robot|human)\b/i;

export const askedForAHuman = (turn: string): boolean => HUMAN.test(turn);

/**
 * Bereavement and acute distress. Immediate, unconditional, and the
 * original task is abandoned rather than continued.
 *
 * CONSERVATIVE ON PURPOSE. A false positive costs one unnecessary
 * handoff. A false negative is a person in difficulty being handled by
 * software, which is not a cost you can average out.
 *
 * These overlap the day-11 memory exclusion categories, reached from
 * the other direction — that list asks what must not be STORED, this
 * asks what must not be HANDLED — and the threshold differs. "I've had
 * a knee replacement so I'll need a buggy" is a routine buggy request.
 * "My husband died" is not a request at all.
 */
const BEREAVEMENT =
  /\b(passed away|passed on|died|death of|deceased|funeral|bereave\w*|widow\w*|late (husband|wife|father|mother|son|daughter|partner))\b/i;

const DISTRESS =
  /\b(terminal\w*|seriously ill|in hospital|hospice|palliative|can'?t cope|breakdown|depress\w+|suicid\w+|desperate|no one (else )?to (talk|turn) to)\b/i;

export function vulnerability(turn: string): "bereavement" | "distress" | undefined {
  if (BEREAVEMENT.test(turn)) return "bereavement";
  if (DISTRESS.test(turn)) return "distress";
  return undefined;
}

/**
 * Frustration, which only escalates ALONGSIDE a refusal.
 *
 * Frustration on its own is a member having a bad day and is not a
 * handoff. Frustration after the agent has just told them no is the
 * club's named accountable owner needing to make a judgement call the
 * rules do not allow the agent to make.
 */
const FRUSTRATED =
  /\b(ridiculous|useless|joke|nonsense|fed up|sick of|not good enough|unacceptable|furious|angry|annoyed|frustrat\w+|complain\w*|shambles|disgrace)\b|[!?]{2,}/i;

export const soundsFrustrated = (turn: string): boolean => FRUSTRATED.test(turn);
