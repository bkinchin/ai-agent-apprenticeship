// Rate limits and the kill switch.
//
// EVERY WRITE TOOL NEEDS A RATE LIMIT. Not because a runaway is
// expected, but because the cost of the limit is zero and the cost of
// its absence is unbounded. Six write tools shipped without one.
//
// AND A CALL CAP, WHICH IS NOT THE SAME AS A STEP CAP. The loop had a
// MAX_STEPS ceiling of 6 and a red-team attack still made 12 tool
// calls, because a model may issue any number of PARALLEL calls per
// inference. Six steps of six calls is thirty-six. The ceiling bounded
// inferences and the spend was never bounded at all.
//
// PERSISTED, because a limit that resets on restart is a limit an
// attacker resets by making the process crash — and because a member
// who hit a daily cap must still have hit it after a deploy.

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";

export interface Limits {
  /** Tool calls in one member turn. Bounds parallel calls, unlike MAX_STEPS. */
  callsPerTurn: number;
  /** Tool calls in one conversation. */
  callsPerSession: number;
  /** Writes by one member in an hour. */
  writesPerMemberPerHour: number;
  /** Writes across the whole club in an hour — the runaway bound. */
  writesGlobalPerHour: number;
}

export const DEFAULTS: Limits = {
  // Generous against real use and tight against a runaway. The club
  // takes ~20 interactions a DAY; a member making 12 calls in one turn
  // is not booking golf.
  callsPerTurn: 6,
  callsPerSession: 25,
  // A member books, cancels, amends. Ten writes in an hour is already
  // a strange hour; a hundred is an incident.
  writesPerMemberPerHour: 10,
  writesGlobalPerHour: 60,
};

export const WRITE_TOOLS = new Set([
  "book_tee_time",
  "cancel_booking",
  "amend_booking",
  "remember_preference",
  "update_what_you_know",
  "forget_everything",
]);

export type Refusal = { limit: keyof Limits; detail: string };

export class RateLimiter {
  private db: DatabaseSync;

  constructor(
    private limits: Limits = DEFAULTS,
    path = process.env.LIMITS_DB ?? ".limits.db",
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS calls (
        at TEXT NOT NULL,
        memberId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        tool TEXT NOT NULL,
        isWrite INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_at ON calls(at);
      CREATE INDEX IF NOT EXISTS idx_member ON calls(memberId, at);
    `);
  }

  /**
   * May this call proceed? Checked BEFORE the tool runs.
   *
   * Returns the limit that refused it, so the member gets a sentence
   * and the log gets a reason — an unexplained refusal is
   * indistinguishable from a bug.
   */
  check(args: {
    memberId: string;
    sessionId: string;
    tool: string;
    callsThisTurn: number;
    now?: Date;
  }): Refusal | undefined {
    const now = args.now ?? new Date();
    const hourAgo = new Date(now.getTime() - 3600e3).toISOString();

    if (args.callsThisTurn >= this.limits.callsPerTurn) {
      return {
        limit: "callsPerTurn",
        detail: `${args.callsThisTurn} tool calls in one turn (limit ${this.limits.callsPerTurn})`,
      };
    }

    const session = this.db
      .prepare(`SELECT COUNT(*) AS n FROM calls WHERE sessionId = ?`)
      .get(args.sessionId) as { n: number };
    if (session.n >= this.limits.callsPerSession) {
      return {
        limit: "callsPerSession",
        detail: `${session.n} tool calls this conversation (limit ${this.limits.callsPerSession})`,
      };
    }

    if (!WRITE_TOOLS.has(args.tool)) return undefined;

    const mine = this.db
      .prepare(`SELECT COUNT(*) AS n FROM calls WHERE memberId = ? AND isWrite = 1 AND at > ?`)
      .get(args.memberId, hourAgo) as { n: number };
    if (mine.n >= this.limits.writesPerMemberPerHour) {
      return {
        limit: "writesPerMemberPerHour",
        detail: `${mine.n} writes in the last hour (limit ${this.limits.writesPerMemberPerHour})`,
      };
    }

    const all = this.db
      .prepare(`SELECT COUNT(*) AS n FROM calls WHERE isWrite = 1 AND at > ?`)
      .get(hourAgo) as { n: number };
    if (all.n >= this.limits.writesGlobalPerHour) {
      // THE RUNAWAY BOUND. If this fires, something systemic is wrong
      // and the right response is to stop, not to serve one more.
      return {
        limit: "writesGlobalPerHour",
        detail: `${all.n} writes club-wide in the last hour (limit ${this.limits.writesGlobalPerHour})`,
      };
    }

    return undefined;
  }

  /** Record a call that actually ran. */
  record(args: { memberId: string; sessionId: string; tool: string; now?: Date }): void {
    this.db
      .prepare(`INSERT INTO calls (at, memberId, sessionId, tool, isWrite) VALUES (?,?,?,?,?)`)
      .run(
        (args.now ?? new Date()).toISOString(),
        args.memberId,
        args.sessionId,
        args.tool,
        WRITE_TOOLS.has(args.tool) ? 1 : 0,
      );
  }

  /** For tests and for the operations runbook's "reset a member" step. */
  clear(memberId?: string): void {
    if (memberId) this.db.prepare(`DELETE FROM calls WHERE memberId = ?`).run(memberId);
    else this.db.exec(`DELETE FROM calls`);
  }
}

// ── the kill switch ─────────────────────────────────────────────

/**
 * Is the agent switched off?
 *
 * TWO MECHANISMS, DELIBERATELY. An environment variable needs a
 * restart, and a restart needs somebody who can deploy. A FILE can be
 * touched by whoever is awake at 3am:
 *
 *   touch .agent-disabled                     stop everything
 *   echo "tee sheet corrupt" > .agent-disabled  with a reason
 *
 * A kill switch that requires a deploy is not a kill switch. It is a
 * plan to have one.
 *
 * Checked per turn rather than cached, because the whole point is that
 * it takes effect without anything being restarted.
 */
export function disabled(): string | undefined {
  if (process.env.AGENT_DISABLED) return process.env.AGENT_DISABLED;
  const file = process.env.KILL_SWITCH_FILE ?? ".agent-disabled";
  if (!existsSync(file)) return undefined;
  try {
    return readFileSync(file, "utf8").trim() || "switched off";
  } catch {
    return "switched off";
  }
}
