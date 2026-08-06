import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Session, SessionStore } from "./session.js";

/**
 * The same contract as InMemorySessionStore, backed by a file on disk.
 *
 * Conversations survive a restart. Nothing that calls this needs to know
 * which of the two stores it's talking to.
 */
export class SqliteSessionStore implements SessionStore {
  private db: DatabaseSync;

  constructor(path = "./data/sessions.db") {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);

    // Runs on every startup. IF NOT EXISTS makes it safe to repeat.
    // history and task_state are JSON strings — SQLite has no array or
    // object type, so we serialise on the way in and parse on the way out.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id          TEXT PRIMARY KEY,
        history     TEXT NOT NULL,
        task_state  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      )
    `);
  }

  async create(): Promise<Session> {
    const session: Session = {
      id: crypto.randomUUID(),
      history: [],
      taskState: {},
    };
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO sessions (id, history, task_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(session.id, "[]", "{}", now, now);

    return session;
  }

  async load(id: string): Promise<Session | null> {
    const row = this.db
      .prepare(`SELECT id, history, task_state FROM sessions WHERE id = ?`)
      .get(id) as { id: string; history: string; task_state: string } | undefined;

    if (!row) return null;

    // Text out of the database, back into real objects.
    return {
      id: row.id,
      history: JSON.parse(row.history),
      taskState: JSON.parse(row.task_state),
    };
  }

  async save(session: Session): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions
            SET history = ?, task_state = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        JSON.stringify(session.history),
        JSON.stringify(session.taskState),
        new Date().toISOString(),
        session.id,
      );
  }
}
