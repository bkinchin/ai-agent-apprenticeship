// The tracer's guarantees, tested without a model or a network.
//
// The one that matters is the last section: observability that can
// break the request is worse than none.

import assert from "node:assert/strict";
import { test } from "node:test";
import { pseudonym, redact, redactDeep } from "./redact.js";
import { computeVersions } from "./versions.js";
import { flush, health, span, trace } from "./tracer.js";

// ═══ redaction ════════════════════════════════════════════════════
test("Australian identifiers are masked", () => {
  // Day 7 measured project 01's PII guard at 0/5 on Australian
  // identifiers — UK phone numbers and National Insurance numbers, for
  // a club in Sydney — and recorded it as a production blocker. The
  // same mistake was available to make twice.
  for (const [text, label] of [
    ["ring me on 0412 345 678", "phone"],
    ["my number is +61 412 345 678", "phone"],
    ["call 02 9411 0388", "phone"],
    ["email me at billy@example.com.au", "email"],
    ["card 4111 1111 1111 1111", "card"],
  ] as [string, string][]) {
    const r = redact(text);
    assert.ok(r.found.includes(label), `"${text}" should find ${label}, found ${r.found}`);
    assert.match(r.text, new RegExp(`\\[${label}\\]`));
  }
});

test("shape is preserved, not deleted", () => {
  // A trace where a member gave a phone number and one where they did
  // not are different facts, and the redacted version must keep the
  // difference.
  const r = redact("ring me on 0412 345 678 about saturday");
  assert.equal(r.text, "ring me on [phone] about saturday");
});

test("ordinary golf talk survives untouched", () => {
  // A guard that mangles normal input is worse than no guard — day 12,
  // the weekday matcher that read every Monday as a Sunday.
  for (const t of [
    "book me saturday at 09:20, just me",
    "I play off 14 and usually go out about 8am",
    "2 guests on 2026-08-29",
    "my reference is B-1rfdzaxv",
  ]) {
    const r = redact(t);
    assert.equal(r.text, t, `should be untouched: "${t}"`);
    assert.deepEqual(r.found, []);
  }
});

test("redaction reaches inside nested structures", () => {
  const { value, found } = redactDeep({
    turn: "call me on 0412 345 678",
    args: { notes: ["email billy@example.com"] },
    partySize: 2,
  });
  assert.match(JSON.stringify(value), /\[phone\]/);
  assert.match(JSON.stringify(value), /\[email\]/);
  assert.equal((value as { partySize: number }).partySize, 2, "numbers survive");
  assert.deepEqual(found.sort(), ["email", "phone"]);
});

test("a member id never appears in a trace", () => {
  const p = pseudonym("M-1001");
  assert.notEqual(p, "M-1001");
  assert.equal(p, pseudonym("M-1001"), "stable, or traces cannot be joined");
  assert.notEqual(p, pseudonym("M-1002"));
  assert.doesNotMatch(p, /1001/);
});

// ═══ versions ═════════════════════════════════════════════════════
test("policy and corpus hash separately", () => {
  // They fail differently and are changed by different people. One
  // combined hash would only say "something in the data moved".
  const base = {
    model: "claude-haiku-4-5",
    promptTemplate: "you are an agent",
    docs: [{ id: "faq.md", body: "hello" }],
    structured: { "fees.yaml": { guest: 20 }, "hours.yaml": { open: "07:00" } },
  };
  const a = computeVersions(base);
  const b = computeVersions({ ...base, structured: { ...base.structured, "fees.yaml": { guest: 25 } } });
  const c = computeVersions({ ...base, docs: [{ id: "faq.md", body: "goodbye" }] });

  assert.notEqual(a.policy, b.policy, "a fee change moves the policy hash");
  assert.equal(a.corpus, b.corpus, "and leaves the corpus hash alone");
  assert.notEqual(a.corpus, c.corpus, "a document change moves the corpus hash");
  assert.equal(a.policy, c.policy, "and leaves the policy hash alone");
});

test("the same inputs give the same versions", () => {
  const args = { model: "m", promptTemplate: "p", docs: [], structured: {} };
  assert.deepEqual(computeVersions(args), computeVersions(args));
});

// ═══ the guarantee ════════════════════════════════════════════════
test("a span returns the work's result and records it", async () => {
  process.env.TRACE_DB = ":memory:";
  const out = await trace({ sessionId: "s1", memberId: "M-1001" }, () =>
    span({ type: "tool", name: "book", input: { slot: "x" } }, async () => "booked"),
  );
  assert.equal(out, "booked");
});

test("A FAILING TRACE STORE DOES NOT FAIL THE REQUEST", async () => {
  // The guarantee this file exists for. A store that is full, locked or
  // missing must degrade to NO TRACES, never to no agent.
  process.env.TRACE_DB = "/nonexistent-directory/traces.db";
  const before = health().dropped;

  const out = await trace({ sessionId: "s2", memberId: "M-1001" }, () =>
    span({ type: "tool", name: "book" }, async () => "still booked"),
  );
  flush();

  assert.equal(out, "still booked", "the agent's work completed");
  // STRICTLY GREATER. This was `>=`, which is trivially true and never
  // proved the failure path had been taken at all — the test passed
  // while exercising a perfectly good store, and only a control found
  // that out.
  assert.ok(
    health().dropped > before,
    `a span must actually have been dropped (was ${before}, now ${health().dropped})`,
  );
});

test("an error inside a span propagates, and is recorded", async () => {
  process.env.TRACE_DB = ":memory:";
  await assert.rejects(
    trace({ sessionId: "s3", memberId: "M-1001" }, () =>
      span({ type: "tool", name: "book" }, async () => {
        throw new Error("tee sheet exploded");
      }),
    ),
    /tee sheet exploded/,
    "the tracer must not swallow the caller's error",
  );
});

test("work outside a trace still runs", async () => {
  // Instrumentation must never become a precondition. A helper called
  // from a script with no trace open has to behave normally.
  const out = await span({ type: "tool", name: "orphan" }, async () => 42);
  assert.equal(out, 42);
});
