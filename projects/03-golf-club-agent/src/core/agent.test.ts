// The loop, tested without a model.
//
// EVERY DEFECT REPLAYED HERE WAS FOUND BY A PERSON TYPING AT THE AGENT
// AND PASTING THE TRANSCRIPT BACK. Not one was found by the suite,
// because the suite could not reach the loop: the model call was
// hardcoded, so testing it needed an API key, a network and a
// non-deterministic model, and therefore never happened. agent.ts was
// the largest file in the project with zero tests.
//
// The model is now injected, so each of these is a scripted response
// and a fixed assertion. They run in milliseconds and cost nothing.
//
// Tools that reach the tee sheet or the corpus are deliberately not
// exercised here — reliability.ts and the knowledge eval own those.
// What these cover is the loop's OWN behaviour: what reaches the
// member, in what order, and when the turn stops.

import assert from "node:assert/strict";
import { test } from "node:test";
import { newSession, turn, memory, type ModelFn, type Reply } from "./agent.js";

// ── scripting a model ───────────────────────────────────────────
const text = (t: string) => ({ type: "text" as const, text: t, citations: null });
const call = (name: string, input: unknown, id = `t-${name}`) =>
  ({ type: "tool_use" as const, id, name, input });

/** Replies the scripted responses in order, and records what it was asked. */
function scripted(...responses: { content: unknown[]; stop_reason: string }[]) {
  const seen: { tool_choice: unknown; messages: unknown[] }[] = [];
  let i = 0;
  const fn: ModelFn = async (req) => {
    seen.push({ tool_choice: req.tool_choice, messages: [...req.messages] });
    const r = responses[i++];
    if (!r) throw new Error(`model called ${i} times; only ${responses.length} scripted`);
    return r as never;
  };
  return { fn, seen, calls: () => i };
}

const member = (n = "M-TEST") => {
  memory.forgetAll(n);
  return newSession(n);
};
const shown = (rs: Reply[]) => rs.filter((r) => r.kind !== "trace");

// ═══ the preamble ═════════════════════════════════════════════════
test("prose written ALONGSIDE tool calls never reaches the member", async () => {
  // "Let me book that for you and save that you like to play early."
  // The save was then refused. The member had been told about something
  // that never happened — an intention stated before the code decided.
  const m = scripted({
    content: [text("Let me book that and save that you like to play early."),
              call("end_turn", { message: "Done." })],
    stop_reason: "tool_use",
  });
  const out = await turn(member(), "hello", m.fn);
  const visible = shown(out).map((r) => (r.kind === "text" ? r.text : "")).join(" ");

  assert.doesNotMatch(visible, /save that you like/, "the preamble must not be shown");
  assert.match(visible, /Done\./, "the tool's own reply is shown");
  assert.ok(out.some((r) => r.kind === "trace" && r.tool === "(preamble)"),
    "but it IS kept for the developer");
});

test("prose with NO tool calls IS the reply", async () => {
  // The legitimate path: the model narrating a read it has already seen.
  const m = scripted({ content: [text("I've got 09:00 or 09:30.")], stop_reason: "end_turn" });
  const out = await turn(member(), "what's free?", m.fn);
  assert.deepEqual(shown(out), [{ kind: "text", text: "I've got 09:00 or 09:30." }]);
});

// ═══ stopping ═════════════════════════════════════════════════════
test("a terminal tool ends the turn without another inference", async () => {
  const m = scripted(
    { content: [call("end_turn", { message: "Cheers." })], stop_reason: "tool_use" },
    { content: [text("...and another thing")], stop_reason: "end_turn" },
  );
  await turn(member(), "thanks", m.fn);
  assert.equal(m.calls(), 1, "the second scripted response must never be requested");
});

test("the tool result is still recorded when the turn ends there", async () => {
  // The API requires every tool_use to be answered by a tool_result in
  // the next message. Returning early without recording it makes the
  // NEXT turn a 400 — a crash one question later, far from its cause.
  const s = member();
  const m = scripted({ content: [call("end_turn", { message: "Cheers." })], stop_reason: "tool_use" });
  await turn(s, "thanks", m.fn);

  const last = s.history[s.history.length - 1];
  assert.equal(last?.role, "user");
  assert.ok(Array.isArray(last?.content), "a tool_result block, not a string");
  assert.equal((last?.content as { type: string }[])[0]?.type, "tool_result");
});

test("the first inference of a turn FORCES a tool call", async () => {
  // Asked "can I bring my dog?", the model decided on its own authority
  // that dogs were out of scope and answered without checking. It was
  // not wrong that time; it showed it could be.
  const m = scripted({ content: [call("end_turn", { message: "ok" })], stop_reason: "tool_use" });
  await turn(member(), "can I bring my dog?", m.fn);
  assert.deepEqual(m.seen[0]?.tool_choice, { type: "any" });
});

test("later inferences do NOT force a tool, or a read could never be narrated", async () => {
  const m = scripted(
    { content: [call("show_what_you_know", {})], stop_reason: "tool_use" },
    { content: [text("that's everything")], stop_reason: "end_turn" },
  );
  // show_what_you_know is terminal, so use a non-terminal tool instead:
  const m2 = scripted(
    { content: [call("remember_preference", { key: "k", quote: "I usually play early" })],
      stop_reason: "tool_use" },
    { content: [text("anything else?")], stop_reason: "end_turn" },
  );
  void m;
  await turn(member(), "I usually play early", m2.fn);
  assert.deepEqual(m2.seen[1]?.tool_choice, { type: "auto" });
});

// ═══ ordering ═════════════════════════════════════════════════════
test("an aside is shown AFTER the answer, whatever order the tools ran in", async () => {
  // A member who asked to be booked read "would you like me to remember
  // that?" before their confirmation, because the model happened to
  // call the tools in that order. Tool order is an implementation
  // detail of one model call; what the member came for is not.
  const m = scripted({
    content: [
      call("remember_preference", { key: "t", quote: "I usually play early" }, "t-1"),
      call("end_turn", { message: "You're all set." }, "t-2"),
    ],
    stop_reason: "tool_use",
  });
  const out = shown(await turn(member(), "book me in, I usually play early", m.fn));
  const kinds = out.map((r) => r.kind);
  assert.ok(kinds.indexOf("aside") > kinds.indexOf("text"), `aside must come last: ${kinds}`);
});

// ═══ consent ══════════════════════════════════════════════════════
test('"no thanks" answers the memory offer — it does NOT reach the model', async () => {
  // A member declined a memory offer and the model called
  // cancel_booking. It failed only because it passed a slot id where a
  // booking id was wanted; with the right handle the booking was gone.
  const s = member();
  s.pendingMemory = { key: "t", value: "v", quote: "I usually play early", turn: "I usually play early" };
  s.consumable = s.pendingMemory;

  const m = scripted(); // ANY model call throws
  const out = await turn(s, "no thanks", m.fn);

  assert.equal(m.calls(), 0, "the model must not be consulted at all");
  assert.match((out[0] as { text: string }).text, /won't note it down/);
  assert.equal(memory.recall(s.memberId).length, 0);
});

test('"yes" commits the draft WE held, not one the model supplies', async () => {
  const s = member();
  s.pendingMemory = { key: "t", value: "I usually play early", quote: "I usually play early", turn: "I usually play early" };
  s.consumable = s.pendingMemory;

  const m = scripted();
  await turn(s, "yes please", m.fn);

  assert.equal(m.calls(), 0);
  const stored = memory.recall(s.memberId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.value, "I usually play early");
  memory.forgetAll(s.memberId);
});

test("a bare yes with NO draft held is an ordinary turn", async () => {
  // The bug this prevents: the agent asks "will 9:30 work?", the member
  // says "yes please", and a memory gets committed with it.
  const s = member();
  const m = scripted({ content: [call("end_turn", { message: "Booked." })], stop_reason: "tool_use" });
  await turn(s, "yes please", m.fn);
  assert.equal(m.calls(), 1, "with nothing pending, a yes goes to the model like anything else");
  assert.equal(memory.recall(s.memberId).length, 0, "and stores nothing");
});

test("a proposal expires after one turn", async () => {
  // A proposal the member walked past is not consent they gave later.
  const s = member();
  s.pendingMemory = { key: "t", value: "v", quote: "q", turn: "I usually play early" };

  const m = scripted(
    { content: [call("end_turn", { message: "ok" })], stop_reason: "tool_use" },
    { content: [call("end_turn", { message: "ok" })], stop_reason: "tool_use" },
  );
  await turn(s, "what are the green fees?", m.fn);   // walks past it
  await turn(s, "yes", m.fn);                         // answers something else

  assert.equal(memory.recall(s.memberId).length, 0, "the stale draft must not commit");
});

// ═══ the ceiling ══════════════════════════════════════════════════
test("the loop stops at MAX_STEPS and says so rather than going silent", async () => {
  // A loop that runs until the model decides to stop is unbounded spend
  // governed by a non-deterministic process. The failure mode is not a
  // crash you would notice — it is a bill.
  const forever = Array.from({ length: 12 }, () => ({
    content: [call("remember_preference", { key: "k", quote: "I usually play early" })],
    stop_reason: "tool_use",
  }));
  const m = scripted(...forever);
  const out = await turn(member(), "hello", m.fn);

  assert.ok(m.calls() <= 6, `must not exceed the ceiling (was ${m.calls()})`);
  assert.ok(shown(out).some((r) => r.kind === "error"), "and must tell the member something");
});

test("a REFUSED terminal tool does not end the turn", async () => {
  // book_tee_time is terminal, so a refused booking ended the turn on
  // the strength of the tool's NAME: the solo guard caught "just me"
  // being booked as four, told the model to book it as one, and the
  // turn stopped before the model could read it. The member got no
  // booking at all — worse than the wrong one being prevented.
  const m = scripted(
    // refused by the solo guard: the member said "just me"
    { content: [call("book_tee_time", { slotId: "x", partySize: 4, guests: 3 })],
      stop_reason: "tool_use" },
    { content: [call("end_turn", { message: "Booked as one." })], stop_reason: "tool_use" },
  );
  const out = await turn(member(), "book me the 9:20, just me", m.fn);

  assert.equal(m.calls(), 2, "the model must get to act on the refusal");
  assert.ok(
    shown(out).some((r) => r.kind === "text" && /Booked as one/.test(r.text)),
    "and the member must end up with an answer",
  );
});
