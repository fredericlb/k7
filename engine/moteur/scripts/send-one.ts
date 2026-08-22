// send-one.ts — compile a project folder and send it to a running engine, once. The smallest
// possible repro of "the file service pushed a document at the engine", for when the browser
// is not the thing under test.
// Usage: npx tsx engine/moteur/scripts/send-one.ts <project-dir> [ws://host:port]

import { EngineClient } from "@studio/engine-client/engineClient";
import { compileNodeProject } from "@studio/song/nodeProject";

const dir = process.argv[2];
const url = process.argv[3] ?? "ws://127.0.0.1:8765";
if (!dir) throw new Error("usage: send-one.ts <project-dir> [ws-url]");

const doc = compileNodeProject(dir);
console.log(
  `compiled ${doc.name}: ${doc.tracks.length} track(s), ${doc.tracks.reduce((n, t) => n + t.clips.length, 0)} clip(s)`,
);

const c = new EngineClient(url, "st0:probe");
c.on("applied", (n: unknown) => console.log("applied:", JSON.stringify(n)));
c.on("error", (e: unknown) => console.log("error:", String(e)));
c.on("warning", (w: unknown) => console.log("warning:", JSON.stringify(w)));
c.connect();

setTimeout(() => {
  c.sendProject(doc);
  setTimeout(() => {
    c.close();
    process.exit(0);
  }, 8000);
}, 1500);
