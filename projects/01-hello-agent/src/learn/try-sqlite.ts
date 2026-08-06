import { SqliteSessionStore } from "../core/sqlite-store.js";

const store = new SqliteSessionStore();

const s = await store.create();
console.log("created:", s.id);

s.history.push({ role: "user", content: "My name is Billy" });
s.taskState.name = "Billy";
await store.save(s);

// Brand new store object — reads the same file from disk
const store2 = new SqliteSessionStore();
const loaded = await store2.load(s.id);
console.log("reloaded from disk:", JSON.stringify(loaded, null, 2));
