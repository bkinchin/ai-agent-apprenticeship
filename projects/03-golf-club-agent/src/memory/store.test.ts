// Memory tests. No model, no server, no API key.
//
// The first one is the reason this file exists. Everything else here
// is a correctness test; the leakage test is a SAFETY test, and it is
// the one that must never be deleted, skipped or weakened — a memory
// system that tells member A something about member B has failed in a
// way no amount of helpfulness compensates for.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore, isAffirmative, mentionedCompany, saidTheyArePlayingAlone, statedAsStanding, excludedBy } from "./store.js";

const NOW = new Date("2026-08-21T10:00:00Z");
const src = (quote: string) => ({ sessionId: "S-1", turnIndex: 0, quote });
const store = () => new MemoryStore(":memory:");

const pref = (value: string, quote = value) =>
  ({ type: "preference" as const, key: "preferred_tee_time", value, confidence: 0.9, source: src(quote) });

// ═══ THE ONE THAT MUST NEVER BE DELETED ═══════════════════════════
test("memory NEVER leaks between members", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00"), NOW);
  s.remember("M-1002", pref("after 14:00"), NOW);
  s.remember("M-1002", { ...pref("plays with a fourball"), key: "group_size" }, NOW);

  const a = s.recall("M-1001", { now: NOW });
  const b = s.recall("M-1002", { now: NOW });

  assert.equal(a.length, 1);
  assert.equal(a[0]?.value, "before 09:00");
  assert.ok(!JSON.stringify(a).includes("14:00"), "M-1001 must not see M-1002's preference");
  assert.ok(!JSON.stringify(a).includes("fourball"));
  assert.equal(b.length, 2);
  for (const m of [...a, ...b]) assert.ok(m.subjectId === "M-1001" || m.subjectId === "M-1002");

  // A member who has never spoken to us knows nothing about anybody.
  assert.deepEqual(s.recall("M-9999", { now: NOW }), []);
  s.close();
});

test("one member cannot correct or delete another's memory", () => {
  const s = store();
  const r = s.remember("M-1001", pref("before 09:00"), NOW);
  assert.ok("stored" in r);
  const id = r.stored.id;

  assert.equal(s.correct("M-1002", id, "after 14:00"), false, "wrong subject must not correct");
  assert.equal(s.forget("M-1002", id), false, "wrong subject must not delete");
  assert.equal(s.recall("M-1001", { now: NOW })[0]?.value, "before 09:00", "unchanged");

  assert.equal(s.forgetAll("M-1002"), 0, "erasing M-1002 must not touch M-1001");
  assert.equal(s.recall("M-1001", { now: NOW }).length, 1);
  s.close();
});

// ═══ the exclusion list ═══════════════════════════════════════════
test("excludes the categories that must never be stored", () => {
  for (const text of [
    "I've had a knee replacement so I need a buggy",
    "I'm struggling to afford the renewal this year",
    "my wife and I have separated",
    "the barman was rude to me",
  ]) {
    assert.ok(excludedBy(text), `should be excluded: "${text}"`);
  }
});

test("excludes on the QUOTE, not just the value", () => {
  const s = store();
  // A sanitised value with a sensitive quote behind it still puts the
  // sensitive text in the database — and the quote is the field we
  // promise to show the member.
  const r = s.remember(
    "M-1001",
    {
      type: "preference", key: "buggy", value: "always books a buggy", confidence: 0.9,
      source: src("I've had a hip operation so I always need a buggy"),
    },
    NOW,
  );
  assert.ok("refused" in r && r.refused === "health");
  assert.deepEqual(s.recall("M-1001", { now: NOW }), []);
  s.close();
});

test("still stores ordinary preferences", () => {
  const s = store();
  assert.ok("stored" in s.remember("M-1001", pref("before 09:00"), NOW));
  assert.ok("stored" in s.remember("M-1001", { ...pref("email"), key: "contact_method" }, NOW));
  assert.equal(s.recall("M-1001", { now: NOW }).length, 2);
  s.close();
});

// ═══ contradiction ════════════════════════════════════════════════
test("a new preference replaces the old one for the same key", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00"), NOW);
  s.remember("M-1001", pref("after 14:00"), new Date("2026-09-01T10:00:00Z"));

  const all = s.recall("M-1001", { now: new Date("2026-09-01T11:00:00Z") });
  assert.equal(all.length, 1, "one preference per key, not two competing ones");
  assert.equal(all[0]?.value, "after 14:00");
  s.close();
});

test("a different key is not a contradiction", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00"), NOW);
  s.remember("M-1001", { ...pref("email"), key: "contact_method" }, NOW);
  assert.equal(s.recall("M-1001", { now: NOW }).length, 2);
  s.close();
});

// ═══ decay ════════════════════════════════════════════════════════
test("a preference lapses after its TTL", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00"), NOW);

  const elevenMonths = new Date("2027-07-01T00:00:00Z");
  const thirteenMonths = new Date("2027-09-30T00:00:00Z");

  assert.equal(s.recall("M-1001", { now: elevenMonths }).length, 1, "still valid at 11 months");
  assert.equal(s.recall("M-1001", { now: thirteenMonths }).length, 0, "lapsed by 13 months");
  s.close();
});

test("correcting a memory renews it", () => {
  const s = store();
  const r = s.remember("M-1001", pref("before 09:00"), NOW);
  assert.ok("stored" in r);

  // A member bothering to fix a memory is the strongest confirmation
  // available — stronger than the inference that created it.
  const later = new Date("2027-06-01T00:00:00Z");
  assert.equal(s.correct("M-1001", r.stored.id, "after 14:00", later), true);

  const m = s.recall("M-1001", { now: later })[0];
  assert.equal(m?.value, "after 14:00");
  assert.equal(m?.confidence, 1.0);
  assert.equal(m?.lastConfirmedAt, later.toISOString());
  s.close();
});

test("a correction cannot smuggle in an excluded category", () => {
  const s = store();
  const r = s.remember("M-1001", pref("before 09:00"), NOW);
  assert.ok("stored" in r);
  assert.equal(s.correct("M-1001", r.stored.id, "needs a buggy after his surgery"), false);
  assert.equal(s.recall("M-1001", { now: NOW })[0]?.value, "before 09:00");
  s.close();
});

// ═══ erasure ══════════════════════════════════════════════════════
test("erasure removes everything and reports how much", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00"), NOW);
  s.remember("M-1001", { ...pref("email"), key: "contact_method" }, NOW);

  assert.equal(s.forgetAll("M-1001"), 2, "must report the count so the member can be told");
  assert.deepEqual(s.recall("M-1001", { now: NOW }), []);
  assert.equal(s.forgetAll("M-1001"), 0, "erasing twice is not an error");
  s.close();
});

// ═══ provenance ═══════════════════════════════════════════════════
test("every memory carries the quote that produced it", () => {
  const s = store();
  s.remember("M-1001", pref("before 09:00", "I'd always rather play before nine if I can"), NOW);
  const m = s.recall("M-1001", { now: NOW })[0];
  assert.match(m?.source.quote ?? "", /before nine/);
  assert.ok(m?.source.sessionId);
  assert.equal(typeof m?.source.turnIndex, "number");
});

// ═══ the write policy ═════════════════════════════════════════════
//
// These exist because the model ignored the tool description twice and
// stored an inferred preference from an aside. The policy is now code,
// so it gets tested like code.

test("a standing instruction may be stored", () => {
  for (const t of [
    "remember that I always want to play before 9am",
    "from now on email me rather than ringing",
    "I'd rather have a morning slot",
    "don't forget I like the back nine first",
    "in future book me a buggy",
  ]) {
    assert.ok(statedAsStanding(t), `should be storable: "${t}"`);
  }
});

test("a description of a habit may NOT be stored", () => {
  for (const t of [
    "the 9:20, just me. I usually play early with the same three lads",
    "I normally play on Saturdays",
    "I tend to go out early",
    "we generally play as a fourball",
    "book me the 9:20 please",
  ]) {
    assert.equal(statedAsStanding(t), false, `should NOT be storable: "${t}"`);
  }
});

test("an affirmative is recognised, but is not itself permission", () => {
  // The recovery path is: offer → "shall I make a note of that?" →
  // "yes please" → store THE DRAFT WE HELD. A yes on its own commits
  // nothing, because the agent asked the member about a tee time once
  // and the model spent the answer on a memory.
  for (const t of ["yes please", "yeah go on", "ok do that", "sure"]) {
    assert.ok(isAffirmative(t), `should be recognised: "${t}"`);
    assert.equal(statedAsStanding(t), false, `"${t}" is not a standing instruction`);
  }
  assert.equal(isAffirmative("yesterday I played badly"), false, "not a bare affirmative");
});

// ═══ the trimmed-quote bypass ═════════════════════════════════════
test("the exclusion list cannot see a category the model trimmed away", () => {
  // This is the BYPASS, asserted so it stays visible rather than
  // looking like an oversight. A member said:
  //
  //   "I've had a knee replacement so remember I'll always need a buggy"
  //
  // and the model handed over the quote "I'll always need a buggy" —
  // correctly, by the tool description, which asks for the part that
  // states the preference. The health rule then saw a clean string.
  //
  // Nothing is wrong with excludedBy here. The bug was upstream: the
  // guard was being shown the model's output instead of the member's
  // words, which is the model marking its own homework.
  const said = "I've had a knee replacement so remember I'll always need a buggy";
  const trimmed = "I'll always need a buggy";

  assert.equal(excludedBy(said), "health", "the full turn is caught");
  assert.equal(excludedBy(trimmed), undefined, "the trimmed quote is not, and cannot be");
});

// ═══ "just me" ════════════════════════════════════════════════════
test("a solo statement is recognised", () => {
  for (const t of [
    "the 9:20, just me. I usually play early with the same three lads",
    "book me in for saturday, only me",
    "just myself this time",
  ]) {
    assert.ok(saidTheyArePlayingAlone(t), `should be solo: "${t}"`);
  }
});

test("but not when they name company in the same breath", () => {
  // "just me and my wife" is two people. The guard must not force it
  // to one and refuse a booking the member actually asked for.
  for (const t of [
    "just me and my wife",
    "just me + a guest",
    "only me and two mates",
    "just me, and my son",
  ]) {
    assert.equal(saidTheyArePlayingAlone(t), false, `should NOT be solo: "${t}"`);
  }
});

// ═══ guests need evidence ═════════════════════════════════════════
test("company is recognised when the member mentions it", () => {
  for (const t of [
    "me and two guests",
    "I'm bringing a mate",
    "playing with my wife",
    "there'll be four of us",
    "me plus 2",
    "we'd like a fourball",
  ]) {
    assert.ok(mentionedCompany([t]), `should imply company: "${t}"`);
  }
});

test("a bare yes is not evidence of a guest", () => {
  // Asked "how many in your party, and will you have any guests?" a
  // member said "yes" and was booked for two with one guest — a count
  // nobody gave, at $20. The solo guard covers "just me"; this covers
  // silence, which is the commoner case.
  assert.equal(mentionedCompany(["can i book saturday at 12pm?", "yes"]), false);
  assert.equal(mentionedCompany(["book me in for sunday", "9:20 please"]), false);
});

test("company anywhere in the conversation counts, not just this turn", () => {
  // "I'm bringing a mate" three turns ago is still evidence.
  assert.ok(mentionedCompany(["I'm bringing a mate", "saturday", "12pm"]));
});
