// callback-cost.mjs — what the AUDIO CALLBACK costs, at rest and under a driven scratch.
//   node engine/moteur/scripts/callback-cost.mjs [setsPerSecond] [seconds]
// Needs the engine's `audio-cost` verb and a session with PLATTERS loaded: it drives Rate on
// deck A's four, the way a hand would, and reads Tracktion's own per-block measurement either
// side. The max is the column that matters — the block that came closest to the deadline.
// It makes NOISE, deliberately: that is the load being measured. Numbers in docs/constat.md.
import { createRequire } from "node:module";
const require = createRequire("C:/Users/flb/Src/studio/package.json");
const WebSocket = require("ws");
const session = "st0:fred_parapluie_org";
const HZ = Number(process.argv[2] ?? 1000), SECS = Number(process.argv[3] ?? 5);
const IDS = ["stemDrumsA", "stemBassA", "stemOtherA", "stemVocalsA"].map((t) => `${t}:platter`);
const ws = new WebSocket("ws://127.0.0.1:8765");
let waiting = null;
ws.on("error", (e) => { console.log("ERREUR:", e.message); process.exit(1); });
ws.on("message", (buf) => {
  let m; try { m = JSON.parse(buf.toString()); } catch { return; }
  if (m.type !== "audio-cost" || !waiting) return;
  const d = waiting; waiting = null; d(m);
});
const ask = (reset) => new Promise((r) => { waiting = r; ws.send(JSON.stringify({ type: "audio-cost", reset })); });
const show = (t, c) => console.log(
  `${t} : ${c.runs} blocs, moyen ${c.meanMs.toFixed(3)} ms, MAX ${c.maxMs.toFixed(3)} ms` +
  ` (${(c.maxMs / c.deadlineMs * 100).toFixed(1)} % de ${c.deadlineMs.toFixed(2)} ms)`);
ws.on("open", async () => {
  await ask(true);
  await new Promise((r) => setTimeout(r, SECS * 1000));
  show("sans geste ", await ask(true));
  let n = 0;
  const t0 = Date.now();
  const timer = setInterval(() => {
    // Une vitesse qui va et vient comme une main sur le disque, entre -2 et +2.
    const rate = 2 * Math.sin((Date.now() - t0) / 120);
    for (const id of IDS) ws.send(JSON.stringify({ type: "set-plugin-param", session, id, name: "Rate", value: rate }));
    n += IDS.length;
  }, Math.max(1, Math.round(1000 / HZ)));
  await new Promise((r) => setTimeout(r, SECS * 1000));
  clearInterval(timer);
  const c = await ask(false);
  show("EN SCRATCH", c);
  console.log(`   ${n} reglages envoyes en ${SECS}s, soit ${Math.round(n / SECS)}/s`);
  for (const id of IDS) ws.send(JSON.stringify({ type: "set-plugin-param", session, id, name: "Rate", value: 0 }));
  setTimeout(() => process.exit(0), 300);
});
