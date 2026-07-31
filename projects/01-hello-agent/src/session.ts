import type Anthropic from "@anthropic-ai/sdk";

export interface Session {
  id: string;
  history: Anthropic.MessageParam[];
  taskState: Record<string, string>;
}

export interface SessionStore {
  create(): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async create(): Promise<Session> {
    const session: Session = {
      id: crypto.randomUUID(),
      history: [],
      taskState: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async load(id: string): Promise<Session | null> {
    return this.sessions.get(id) ?? null;
  }

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }
}
