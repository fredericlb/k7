import { WebSocket } from "ws";
import { readFileSync } from "node:fs";
const tok = JSON.parse(readFileSync("C:/Users/flb/.studio/engine-id.json", "utf8")).token;
const ws = new WebSocket(`ws://127.0.0.1:8765/?token=${tok}`);
ws.on("open", () => ws.send(JSON.stringify({ type: "list-sessions" })));
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === "sessions") { console.log(JSON.stringify(m.sessions ?? m, null, 1).slice(0, 500)); ws.close(); process.exit(0); }
});
ws.on("error", (e) => { console.log("erreur:", e.message); process.exit(1); });
setTimeout(() => { console.log("pas de réponse"); process.exit(1); }, 5000);
