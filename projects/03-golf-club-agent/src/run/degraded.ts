// Degraded mode.
//
//   npm run degraded
//
// When the tee sheet is unreachable the agent must not die. It should
// still answer knowledge questions, still tell the truth about what it
// cannot do right now, and still say something a member can act on.
//
// Degraded behaviour is not an error path you fall into. It is a mode
// you design, and it WILL be exercised — a spreadsheet-backed booking
// system will be unavailable more often than a real one.

import { spawn } from "node:child_process";
import { bookTeeTime } from "../tools/tee-sheet.js";
import { circuitState, resetCircuit } from "../tools/client.js";
import { ask } from "../core/answer.js";
import { loadDocuments, loadStructured } from "../core/corpus.js";

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const SLOT = `${tomorrow}T10:40`;
const docs = loadDocuments();
const structured = loadStructured();

const server = spawn("npx", ["tsx", "tee-sheet/server.ts"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 3000));

console.log("\n─── tee sheet UP ───────────────────────────────────");
const ok = await bookTeeTime({
  slotId: SLOT, memberId: "M-1002", partySize: 2, guests: 0, sessionId: "S-up",
});
console.log(`  booking: ${ok.status}${ok.status === "booked" ? `  ${ok.bookingId}` : ""}`);

// ── kill it mid-conversation ────────────────────────────────────
server.kill();
await new Promise((r) => setTimeout(r, 500));
resetCircuit();

console.log("\n─── tee sheet DOWN ─────────────────────────────────");

// 1. Booking fails — but as an outcome, not an exception.
const down = await bookTeeTime({
  slotId: `${tomorrow}T10:50`, memberId: "M-1002", partySize: 2, guests: 0, sessionId: "S-down",
});
console.log(`  booking: ${down.status}`);
if (down.status === "unavailable") console.log(`           reason: ${down.reason}`);

// 2. Repeated attempts trip the breaker rather than hammering a dead
//    host. Fail fast, and stop making someone else's outage worse.
for (let i = 0; i < 5; i++) {
  await bookTeeTime({
    slotId: `${tomorrow}T11:0${i}`, memberId: "M-1002", partySize: 1, guests: 0, sessionId: `S-x${i}`,
  }).catch(() => {});
}
const c = circuitState();
console.log(`  circuit: ${c.open ? `OPEN — failing fast for ${Math.ceil(c.reopensIn / 1000)}s` : `closed (${c.failures} failures)`}`);

// 3. THE POINT: knowledge is a separate system and keeps working when
//    the tee sheet does not.
//
//    THIS BLOCK WAS NOT WRAPPED THE FIRST TIME, and the script crashed
//    when the Anthropic API returned 402. A degraded-mode demonstration
//    that cannot survive one of its own dependencies going down is not
//    demonstrating anything.
//
//    The agent has TWO external dependencies, not one. Designing for
//    the tee sheet and forgetting the model is exactly the mistake this
//    exercise is about.
try {
  const answer = await ask("How much does it cost to bring a guest?", docs, structured);
  console.log(`\n  knowledge: ${answer.answer?.status === "answered" ? "still working" : "no answer"}`);
  if (answer.answer?.status === "answered") {
    console.log(`             "${answer.answer.answer.slice(0, 90)}"`);
  }
} catch (e) {
  const why = (e as Error).message.slice(0, 70);
  console.log(`\n  knowledge: ALSO DOWN — ${why}`);
  console.log(`             (both dependencies unavailable — the agent has nothing to offer`);
  console.log(`              but an honest handover, which is still better than a crash)`);
}

console.log(`
  What a member would hear:

    "I can't reach the booking system at the moment, so I can't hold
     that slot — I'd give the pro shop a ring on that one. Anything
     else I can help with in the meantime?"

  Not a stack trace, and not silence. The agent knows which of its
  capabilities is down and says so specifically.
`);
