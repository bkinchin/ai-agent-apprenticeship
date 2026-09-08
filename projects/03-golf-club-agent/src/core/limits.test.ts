// Rate limits and the kill switch. No model, no network.

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, RateLimiter, WRITE_TOOLS, disabled } from "./limits.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

const NOW = new Date("2026-09-08T10:00:00+10:00");
const fresh = () => new RateLimiter(DEFAULTS, ":memory:");

test("every write tool is covered", () => {
  // Six write tools shipped with no rate limit at all. The cost of the
  // limit is zero; the cost of its absence is unbounded.
  for (const t of [
    "book_tee_time", "cancel_booking", "amend_booking",
    "remember_preference", "update_what_you_know", "forget_everything",
  ]) {
    assert.ok(WRITE_TOOLS.has(t), `${t} must be rate limited`);
  }
});

test("reads are not write-limited, but ARE call-limited", () => {
  const l = fresh();
  assert.equal(l.check({ memberId: "M-1", sessionId: "s", tool: "check_availability", callsThisTurn: 0, now: NOW }), undefined);
  const r = l.check({ memberId: "M-1", sessionId: "s", tool: "check_availability", callsThisTurn: 6, now: NOW });
  assert.equal(r?.limit, "callsPerTurn");
});

test("the per-turn cap bounds PARALLEL calls, which MAX_STEPS does not", () => {
  // A red-team attack made 12 tool calls inside a ceiling of 6 steps,
  // because a model may issue any number of parallel calls per
  // inference. Six steps of six calls is thirty-six.
  const l = fresh();
  assert.equal(l.check({ memberId: "M-1", sessionId: "s", tool: "check_availability", callsThisTurn: 5, now: NOW }), undefined);
  assert.ok(l.check({ memberId: "M-1", sessionId: "s", tool: "check_availability", callsThisTurn: 6, now: NOW }));
});

test("a member's writes are capped per hour", () => {
  const l = fresh();
  for (let i = 0; i < DEFAULTS.writesPerMemberPerHour; i++) {
    assert.equal(
      l.check({ memberId: "M-1", sessionId: `s${i}`, tool: "book_tee_time", callsThisTurn: 0, now: NOW }),
      undefined,
      `write ${i + 1} should be allowed`,
    );
    l.record({ memberId: "M-1", sessionId: `s${i}`, tool: "book_tee_time", now: NOW });
  }
  const r = l.check({ memberId: "M-1", sessionId: "sX", tool: "book_tee_time", callsThisTurn: 0, now: NOW });
  assert.equal(r?.limit, "writesPerMemberPerHour");
});

test("one member's budget is not another's", () => {
  const l = fresh();
  for (let i = 0; i < DEFAULTS.writesPerMemberPerHour; i++) {
    l.record({ memberId: "M-1", sessionId: "s", tool: "book_tee_time", now: NOW });
  }
  assert.ok(l.check({ memberId: "M-1", sessionId: "s2", tool: "book_tee_time", callsThisTurn: 0, now: NOW }));
  assert.equal(
    l.check({ memberId: "M-2", sessionId: "s3", tool: "book_tee_time", callsThisTurn: 0, now: NOW }),
    undefined,
    "M-2 has spent nothing",
  );
});

test("the hour is a rolling window, not a bucket", () => {
  const l = fresh();
  const earlier = new Date(NOW.getTime() - 2 * 3600e3);
  for (let i = 0; i < DEFAULTS.writesPerMemberPerHour; i++) {
    l.record({ memberId: "M-1", sessionId: "s", tool: "book_tee_time", now: earlier });
  }
  assert.equal(
    l.check({ memberId: "M-1", sessionId: "s2", tool: "book_tee_time", callsThisTurn: 0, now: NOW }),
    undefined,
    "two hours ago does not count against this hour",
  );
});

test("the club-wide cap catches a runaway one member's cap would not", () => {
  // The bound that matters for a systemic failure: many members, each
  // under their own limit, adding up to something nobody intended.
  const l = fresh();
  for (let i = 0; i < DEFAULTS.writesGlobalPerHour; i++) {
    l.record({ memberId: `M-${i % 20}`, sessionId: `s${i}`, tool: "book_tee_time", now: NOW });
  }
  const r = l.check({ memberId: "M-fresh", sessionId: "sX", tool: "book_tee_time", callsThisTurn: 0, now: NOW });
  assert.equal(r?.limit, "writesGlobalPerHour", "a member who has spent nothing is still stopped");
});

test("a refusal says which limit and why", () => {
  // An unexplained refusal is indistinguishable from a bug, and the
  // member gets a sentence built from it.
  const l = fresh();
  for (let i = 0; i < DEFAULTS.writesPerMemberPerHour; i++) {
    l.record({ memberId: "M-1", sessionId: "s", tool: "cancel_booking", now: NOW });
  }
  const r = l.check({ memberId: "M-1", sessionId: "s2", tool: "cancel_booking", callsThisTurn: 0, now: NOW });
  assert.match(r?.detail ?? "", /\d+ writes in the last hour/);
});

// ═══ the kill switch ══════════════════════════════════════════════
test("a file switches the agent off, with no restart and no deploy", () => {
  // A kill switch that requires a deploy is not a kill switch, it is a
  // plan to have one. Whoever is awake at 3am can touch a file.
  const f = "/private/tmp/claude-501/-Users-billykinchin-AI-AGENT-ENGINEERING-APPRENTICESHIP/ad784ad3-3e15-465d-97f9-c780fda4401e/scratchpad/.kill-test";
  process.env.KILL_SWITCH_FILE = f;
  delete process.env.AGENT_DISABLED;

  assert.equal(disabled(), undefined, "off by default");
  writeFileSync(f, "tee sheet corrupt");
  assert.equal(disabled(), "tee sheet corrupt", "and it carries the reason");
  unlinkSync(f);
  assert.equal(disabled(), undefined, "and back on when the file goes");
  if (existsSync(f)) unlinkSync(f);
});

test("an empty file still counts as off", () => {
  // `touch .agent-disabled` is what somebody will actually type.
  const f = "/private/tmp/claude-501/-Users-billykinchin-AI-AGENT-ENGINEERING-APPRENTICESHIP/ad784ad3-3e15-465d-97f9-c780fda4401e/scratchpad/.kill-test2";
  process.env.KILL_SWITCH_FILE = f;
  writeFileSync(f, "");
  assert.ok(disabled(), "an empty file must not read as 'on'");
  unlinkSync(f);
});
