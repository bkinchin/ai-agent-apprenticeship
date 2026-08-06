import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { assemble } from "./context.js";

const SYS = "You are a helpful assistant.";

/** Six messages: u1, a1, u2, a2, u3, a3 */
const six: Anthropic.MessageParam[] = [
  { role: "user", content: "u1" },
  { role: "assistant", content: "a1" },
  { role: "user", content: "u2" },
  { role: "assistant", content: "a2" },
  { role: "user", content: "u3" },
  { role: "assistant", content: "a3" },
];

const contentOf = (m: Anthropic.MessageParam[]) => m.map((x) => x.content);

// ── the system prompt ────────────────────────────────────────────

test("empty task state leaves the system prompt untouched", () => {
  const { system } = assemble({ systemPrompt: SYS, taskState: {}, history: [], window: 6 });
  assert.equal(system, SYS);
});

test("task state is appended as a facts block", () => {
  const { system } = assemble({
    systemPrompt: SYS,
    taskState: { name: "Billy" },
    history: [],
    window: 6,
  });
  assert.ok(system.startsWith(SYS), "base prompt must come first");
  assert.ok(system.includes("- name: Billy"), "fact must appear");
});

test("every fact reaches the model", () => {
  const { system } = assemble({
    systemPrompt: SYS,
    taskState: { name: "Billy", plan: "PRO", verified: "true" },
    history: [],
    window: 6,
  });
  for (const f of ["- name: Billy", "- plan: PRO", "- verified: true"]) {
    assert.ok(system.includes(f), `missing ${f}`);
  }
});

// ── the window ───────────────────────────────────────────────────

test("window keeps the most recent messages, in order", () => {
  const { messages } = assemble({ systemPrompt: SYS, taskState: {}, history: six, window: 2 });
  assert.deepEqual(contentOf(messages), ["u3", "a3"]);
});

test("history shorter than the window is returned whole", () => {
  const { messages } = assemble({ systemPrompt: SYS, taskState: {}, history: six, window: 100 });
  assert.equal(messages.length, 6);
});

test("empty history yields no messages", () => {
  const { messages } = assemble({ systemPrompt: SYS, taskState: {}, history: [], window: 6 });
  assert.deepEqual(messages, []);
});

test("a window of zero sends no conversation", () => {
  const { messages } = assemble({ systemPrompt: SYS, taskState: {}, history: six, window: 0 });
  assert.deepEqual(messages, []);
});

// ── purity ───────────────────────────────────────────────────────

test("assemble does not mutate its inputs", () => {
  const history = [...six];
  const taskState = { name: "Billy" };
  assemble({ systemPrompt: SYS, taskState, history, window: 2 });
  assert.equal(history.length, 6, "history was mutated");
  assert.deepEqual(taskState, { name: "Billy" }, "taskState was mutated");
});

test("same input, same output", () => {
  const input = {
    systemPrompt: SYS,
    taskState: { name: "Billy" },
    history: six,
    window: 3,
  };
  assert.deepEqual(assemble(input), assemble(input));
});
