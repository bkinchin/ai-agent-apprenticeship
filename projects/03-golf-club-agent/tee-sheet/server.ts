// A fake tee-sheet API — deliberately hostile.
//
//   npx tsx tee-sheet/server.ts
//   npx tsx tee-sheet/server.ts --latency 2000 --error-rate 0.3
//   npx tsx tee-sheet/server.ts --flaky-writes        ← the important one
//
// WHY A REAL HTTP SERVER rather than an in-process function: the whole
// point of today is what happens when the network is in the loop.
// Timeouts, partial failures and ambiguous writes do not exist in a
// function call, and an in-process fake teaches you nothing about them.
//
// IT DOES NOT SUPPORT IDEMPOTENCY KEYS, on purpose. The golf club's
// real tee sheet is a Google Sheet, which supports nothing of the kind,
// and "the supplier will not add it" is the situation most enterprise
// projects are actually in. The protection has to live on our side.
//
// --flaky-writes is the one worth engineering against: the write
// COMMITS and then returns 500. The client cannot tell success from
// failure, which is precisely the case idempotency exists for.

import { createServer } from "node:http";

// ── hostility ───────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string, fallback = 0): number => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
// Mutable, so tests can turn a specific failure on for a specific call
// rather than hoping a probability fires. A reliability test that is
// itself flaky proves nothing.
const HOSTILITY = {
  latencyMs: flag("latency"),
  errorRate: flag("error-rate"),
  timeoutRate: flag("timeout-rate"),
  /** Commit the write, THEN fail. The ambiguous case. */
  flakyWrites: argv.includes("--flaky-writes"),
};

// ── the world ───────────────────────────────────────────────────
interface Slot { id: string; date: string; time: string; }
interface Hold { id: string; slotId: string; memberId: string; expiresAt: number; }
interface Booking {
  id: string; slotId: string; memberId: string;
  partySize: number; guests: number; createdAt: string;
}

const MEMBERS: Record<string, { name: string; category: string; guestsUsedThisMonth: number }> = {
  "M-1001": { name: "Billy Kinchin", category: "full", guestsUsedThisMonth: 2 },
  "M-1002": { name: "Sam Okafor", category: "midweek", guestsUsedThisMonth: 0 },
  "M-1003": { name: "Dev Sharma", category: "country", guestsUsedThisMonth: 4 },
};

/** Ten-minute intervals, 07:00–17:30, for the next 14 days. */
const slots: Slot[] = [];
for (let d = 0; d < 14; d++) {
  const date = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  for (let m = 7 * 60; m <= 17 * 60 + 30; m += 10) {
    const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    slots.push({ id: `${date}T${time}`, date, time });
  }
}

const holds = new Map<string, Hold>();
const bookings = new Map<string, Booking>();

const now = () => Date.now();
const liveHolds = () => {
  // Expiry is evaluated on read. No sweeper, no cleanup job, no failure
  // path for the cleanup — which is the whole argument for preferring
  // expiry over explicit rollback.
  for (const [id, h] of holds) if (h.expiresAt <= now()) holds.delete(id);
  return holds;
};
const slotTaken = (slotId: string) =>
  [...bookings.values()].some((b) => b.slotId === slotId) ||
  [...liveHolds().values()].some((h) => h.slotId === slotId);

// ── routing ─────────────────────────────────────────────────────
type Handler = (body: any, query: URLSearchParams, params: string[]) => unknown;

const routes: [string, RegExp, Handler][] = [
  ["GET", /^\/availability$/, (_b, q) => {
    const date = q.get("date");
    const from = q.get("from") ?? "00:00";
    const to = q.get("to") ?? "23:59";
    return {
      slots: slots
        .filter((s) => s.date === date && s.time >= from && s.time <= to && !slotTaken(s.id))
        .map((s) => ({ slotId: s.id, date: s.date, time: s.time })),
    };
  }],

  ["POST", /^\/holds$/, (b) => {
    if (!slots.some((s) => s.id === b.slotId)) throw new HttpError(404, "no such slot");
    if (slotTaken(b.slotId)) throw new HttpError(409, "slot is already held or booked");
    const id = `H-${Math.random().toString(36).slice(2, 10)}`;
    const ttl = Number(b.ttlSeconds ?? 300) * 1000;
    holds.set(id, { id, slotId: b.slotId, memberId: b.memberId, expiresAt: now() + ttl });
    return { holdId: id, slotId: b.slotId, expiresAt: new Date(now() + ttl).toISOString() };
  }],

  ["POST", /^\/holds\/([^/]+)\/refresh$/, (b, _q, p) => {
    const h = liveHolds().get(p[0]!);
    if (!h) throw new HttpError(404, "hold not found or expired");
    h.expiresAt = now() + Number(b?.ttlSeconds ?? 300) * 1000;
    return { holdId: h.id, expiresAt: new Date(h.expiresAt).toISOString() };
  }],

  ["DELETE", /^\/holds\/([^/]+)$/, (_b, _q, p) => {
    holds.delete(p[0]!);
    return { released: true };
  }],

  ["POST", /^\/bookings$/, (b) => {
    const h = liveHolds().get(b.holdId);
    if (!h) throw new HttpError(409, "hold not found or expired");
    if (h.memberId !== b.memberId) throw new HttpError(403, "hold belongs to another member");
    // NOTE: no idempotency key handling. Deliberate — see the header.
    const id = `B-${Math.random().toString(36).slice(2, 10)}`;
    bookings.set(id, {
      id, slotId: h.slotId, memberId: b.memberId,
      partySize: b.partySize ?? 1, guests: b.guests ?? 0,
      createdAt: new Date().toISOString(),
    });
    holds.delete(h.id);
    return { bookingId: id, slotId: h.slotId, memberId: b.memberId };
  }],

  ["DELETE", /^\/bookings\/([^/]+)$/, (_b, _q, p) => {
    if (!bookings.has(p[0]!)) throw new HttpError(404, "no such booking");
    bookings.delete(p[0]!);
    return { cancelled: true };
  }],

  ["GET", /^\/bookings$/, (_b, q) => {
    const memberId = q.get("memberId");
    return {
      bookings: [...bookings.values()].filter((b) => !memberId || b.memberId === memberId),
    };
  }],

  ["GET", /^\/members\/([^/]+)\/allowance$/, (_b, _q, p) => {
    const m = MEMBERS[p[0]!];
    if (!m) throw new HttpError(404, "no such member");
    const live = [...bookings.values()].filter((b) => b.memberId === p[0]).length;
    return {
      memberId: p[0], category: m.category,
      liveBookings: live, maxLiveBookings: 2,
      guestsUsedThisMonth: m.guestsUsedThisMonth,
      maxGuestsPerMonth: m.category === "full" ? 6 : 4,
    };
  }],

  ["GET", /^\/competitions$/, () => ({
    competitions: [
      { id: "C-1", name: "Saturday Medal", day: "saturday", from: "08:30", to: "11:00" },
    ],
  })],

  // For tests: reset the world, and inspect it without going through
  // the hostility layer.
  ["POST", /^\/_reset$/, () => { holds.clear(); bookings.clear(); return { ok: true }; }],
  ["POST", /^\/_hostility$/, (b) => { Object.assign(HOSTILITY, b); return { ...HOSTILITY }; }],
  ["GET", /^\/_state$/, () => ({
    bookings: [...bookings.values()], holds: [...liveHolds().values()],
  })],
];

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const isWrite = (method: string) => method !== "GET";
const isInternal = (path: string) => path.startsWith("/_");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};

  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  // ── the hostility layer ───────────────────────────────────────
  // Internal endpoints bypass it, so tests can always read the truth.
  if (!isInternal(url.pathname)) {
    if (HOSTILITY.latencyMs) await new Promise((r) => setTimeout(r, HOSTILITY.latencyMs));

    // A timeout is silence, not an error. The socket simply never
    // answers — which is what makes it ambiguous.
    if (Math.random() < HOSTILITY.timeoutRate) return;

    if (Math.random() < HOSTILITY.errorRate) {
      return send(503, { error: "service unavailable" });
    }
  }

  const route = routes.find(
    ([method, pattern]) => method === req.method && pattern.test(url.pathname),
  );
  if (!route) return send(404, { error: "not found" });

  const params = url.pathname.match(route[1])!.slice(1);
  try {
    const result = route[2](body, url.searchParams, params);

    // ── the case this whole day exists for ──────────────────────
    // The write COMMITTED. Then we fail. The client cannot tell this
    // from a write that never happened, and retrying naively creates a
    // second booking.
    if (HOSTILITY.flakyWrites && isWrite(req.method!) && !isInternal(url.pathname)) {
      return send(500, { error: "internal error (the write actually succeeded)" });
    }

    send(200, result);
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message });
    send(500, { error: (e as Error).message });
  }
});

const PORT = Number(process.env.TEE_SHEET_PORT ?? 4010);
server.listen(PORT, () => {
  const on = Object.entries(HOSTILITY).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  console.log(`tee sheet on :${PORT}${on.length ? `  hostility: ${on.join(" ")}` : "  (well behaved)"}`);
});
