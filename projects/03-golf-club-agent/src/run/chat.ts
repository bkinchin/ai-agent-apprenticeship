// Talk to the golf club agent.
//
//   npm run chat
//   ANTHROPIC_MODEL=claude-opus-5 npm run chat
//
// `npm run ask` is the day-9 harness: one question, one cited answer, no
// conversation and no tools. This is the agent — a loop, a history, and
// tools it can call.
//
// It exists for the same reason `ask` did. Fourteen of week one's
// twenty-two defects were found by a person typing at an agent and
// reading what came back; two were found by the golden set. Every
// serious defect on days 9 and 10 was found the same way. A suite is a
// ratchet — it stops things getting worse. A transcript is a detector.

import { createInterface } from "node:readline/promises";
import { newSession, turn, type Reply } from "../core/agent.js";
import { MODEL } from "../core/answer.js";
import { loadStructured } from "../core/corpus.js";
import { contactsFrom, devLines, memberText } from "../core/render.js";

const contacts = contactsFrom(loadStructured());
let session = newSession("M001");
/** Show the developer view. Off = exactly what a member would see. */
let dev = true;

console.log(`
┌──────────────────────────────────────────────────────────────────┐
│  Golf club member agent                                          │
│                                                                  │
│  model: ${MODEL.padEnd(56)}│
│  member: ${session.memberId.padEnd(55)}│
│                                                                  │
│  /login <id>  /quiet  /session  /reset  /exit                         │
└──────────────────────────────────────────────────────────────────┘

Worth trying:
  · how much does it cost to bring a guest?
  · and for two?                              ← the reference test
  · can I wear jeans in the spike bar?
  · can I bring my dog?
`);

const rl = createInterface({ input: process.stdin, output: process.stdout });

/**
 * TWO VIEWS OF ONE OBJECT.
 *
 * The member's line is assembled by code from verified fields; the
 * developer's lines are everything the member does not see. They are
 * printed together, clearly separated, because the diagnostics are how
 * defects get found — the problem was never that they existed, it was
 * that they were arriving inside the member's message.
 */
function show(r: Reply): void {
  const text = memberText(r, contacts);
  if (text !== null) console.log(`\n${text}\n`);

  if (!dev) return;
  for (const line of devLines(r)) {
    const alarm = line.startsWith("⚑");
    console.log(`  \x1b[${alarm ? "31" : "2"}m${line}\x1b[0m`);
  }
  if (devLines(r).length > 0) console.log("");
}

/**
 * One line of input. Returns false when the conversation should end.
 *
 * Extracted from the loop because there are now TWO drivers — a human
 * typing, and a script piped in — and they must exercise the same path.
 * A test that goes through a different code path than production is
 * testing a different program.
 */
async function handle(input: string): Promise<boolean> {
  if (!input) return true;

  if (input === "/exit") return false;
  if (input === "/reset") {
    session = newSession(session.memberId);
    console.log("  new session\n");
    return true;
  }
  if (input === "/quiet") {
    dev = !dev;
    console.log(`  developer view ${dev ? "on" : "off — this is exactly what a member sees"}\n`);
    return true;
  }
  if (input === "/session") {
    console.log(
      `  member ${session.memberId} · session ${session.sessionId} · ` +
        `step ${session.step} · ${session.history.length} messages\n`,
    );
    return true;
  }
  if (input.startsWith("/login ")) {
    // A STUB, and deliberately a visible one. Nothing authenticates this.
    session = newSession(input.slice(7).trim());
    console.log(`  \x1b[33mnow ${session.memberId} — unauthenticated, see agent.ts\x1b[0m\n`);
    return true;
  }

  try {
    for (const r of await turn(session, input)) show(r);
  } catch (e) {
    // Degraded mode has to cover EVERY dependency — day 10's mistake was
    // wrapping the tee sheet carefully and leaving the model call bare.
    //
    // The member gets a sentence built from the contact directory. The
    // exception goes to the developer view. Previously both were one
    // line, and that line contained a phone number invented in source.
    show({ kind: "error", text: (e as Error).message });
  }
  return true;
}

// TWO DRIVERS, ONE PATH.
//
// readline CONSUMES STDIN WHILE YOU AWAIT. Piped lines that arrive
// during a model call find no pending question() and are silently
// dropped; the next question() then hits EOF and the loop exits. A
// human never notices, because a human is slower than the API — so the
// bug only appears the moment you try to TEST a multi-turn conversation,
// which is the one thing this loop exists to have.
//
// So a non-TTY stdin is read to completion first and replayed turn by
// turn. Same `handle`, same agent, no dropped lines.
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    let input: string;
    try {
      input = (await rl.question("\x1b[36myou › \x1b[0m")).trim();
    } catch {
      break; // EOF
    }
    if (!(await handle(input))) break;
  }
  rl.close();
} else {
  const script = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => resolve(buf));
  });
  for (const line of script.split("\n")) {
    console.log(`\x1b[36myou › \x1b[0m${line.trim()}`);
    if (!(await handle(line.trim()))) break;
  }
}
