import { test } from "node:test";
import assert from "node:assert/strict";
import { systemPromptFor } from "./conversation.js";
import { STAGE_TOOLS, type Stage } from "./workflow.js";

// The system prompt describes the process to the model. It is a document,
// and documents go stale — except this one goes stale into production, on
// every call, where no other test can see it.
//
// RETENTION was missing from it for a day after the stage was added. 70
// unit tests and 9 eval cases all passed with a prompt that misdescribed
// the flow.

const ALL_STAGES = Object.keys(STAGE_TOOLS) as Stage[];

test("every real stage appears in the process description", () => {
  const prompt = systemPromptFor("GREETING");
  for (const stage of ALL_STAGES) {
    if (stage === "ESCALATED") continue; // terminal handoff, not a flow step
    assert.ok(prompt.includes(stage), `"${stage}" is missing from the system prompt`);
  }
});

test("the prompt describes no stage that does not exist", () => {
  const prompt = systemPromptFor("GREETING");
  const mentioned = prompt.match(/\b[A-Z]{5,}\b/g) ?? [];
  for (const word of new Set(mentioned)) {
    if (word === "ONE" || word === "NOT" || word === "IRREVERSIBLE" || word === "YES") continue;
    assert.ok(
      (ALL_STAGES as string[]).includes(word),
      `prompt mentions "${word}", which is not a stage`,
    );
  }
});

test("the current stage is always stated", () => {
  for (const stage of ALL_STAGES) {
    assert.match(systemPromptFor(stage), new RegExp(`currently at: ${stage}`));
  }
});
