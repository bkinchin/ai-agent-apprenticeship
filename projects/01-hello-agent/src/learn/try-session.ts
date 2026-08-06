import { InMemorySessionStore } from "../core/session.js";

const store = new InMemorySessionStore();

const session = await store.create();
console.log("created:", session.id);

session.history.push({ role: "user", content: "My name is Billy" });
session.taskState.name = "Billy";
await store.save(session);

const loaded = await store.load(session.id);
console.log("loaded :", loaded);

const missing = await store.load("does-not-exist");
console.log("missing:", missing);