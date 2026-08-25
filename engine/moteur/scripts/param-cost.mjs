// param-cost.mjs — what one set-plugin-param really costs, against a RUNNING engine.
//   node engine/moteur/scripts/param-cost.mjs [pluginId]
// Total wall clock to push N sets AND see the engine past them: emission + drain, against a
// control that stops at the map miss. Real sets re-send each param's CURRENT value, so the
// whole path runs and the sound never moves.
// The engine must have a PROJECT LOADED: without one the real column measures the control
// too, and the answer reads as "free". The numbers this produced are in docs/constat.md.
import { createRequire } from "node:module";
const require = createRequire("C:/Users/flb/Src/studio/package.json");
const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:8765");
const session = "st0:fred_parapluie_org";
const ID = process.argv[2] ?? "eqA:eqA";
const send = (o) => ws.send(JSON.stringify({ ...o, session }));
let waiting = null, params = null;
ws.on("error", (e) => { console.log("ERREUR:", e.message); process.exit(1); });
ws.on("message", (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.type !== "plugin-params" && m.type !== "error") return;
  if (m.params) params = m.params;
  if (waiting) { const d = waiting; waiting = null; d(); }
});
const probe = () => new Promise((r) => { waiting = r; send({ type: "get-plugin-params", id: ID }); });
const run = async (n, real) => {
  const ns = Object.keys(params);
  const t = performance.now();
  for (let i = 0; i < n; i++) {
    const name = real ? ns[i % ns.length] : "Rate";
    send({ type: "set-plugin-param", id: real ? ID : "pasDePlugin:aucun", name,
           value: real ? params[name] : 0 });
  }
  const sent = performance.now() - t;
  await probe();
  return [sent, performance.now() - t];
};
const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
ws.on("open", async () => {
  await new Promise((r) => setTimeout(r, 400));
  await probe();
  console.log(`${ID} : ${Object.keys(params).length} parametres`);
  for (const n of [5000, 20000]) {
    const C = [], R = [];
    for (let k = 0; k < 5; k++) { C.push((await run(n, false))[1]); R.push((await run(n, true))[1]); }
    const c = med(C), r = med(R);
    console.log(`${String(n).padStart(6)} : temoin ${c.toFixed(0)} ms | reels ${r.toFixed(0)} ms` +
      `  ->  ecart ${((r - c) * 1000 / n).toFixed(2)} us/reglage, debit reel ${Math.round(n / r * 1000)}/s`);
  }
  process.exit(0);
});
setTimeout(() => { console.log("pas de reponse"); process.exit(1); }, 180000);
