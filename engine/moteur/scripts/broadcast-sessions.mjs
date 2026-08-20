// broadcast-sessions.mjs — the proof that the AUDIO is per session: two projects under two
// session ids on one engine, two listeners, each hearing only the one it subscribed for.
// Raw JSON on purpose, so it tests the engine alone; two-sessions.ts covers the clients.
//   node engine/moteur/scripts/broadcast-sessions.mjs   (engine on :8833)

import WebSocket from "ws";
const doc = (name, key) => ({ name, tempo:120, sampleRate:48000, timeSigNumerator:4, timeSigDenominator:4,
  recordDir:"", settings:{metronome:false,countIn:0}, groups:[],
  tracks:[{ id:"t1", name, clips:[{id:"c1",type:"midi",name:"t",start:0,length:600,
    notes:[{time:0,duration:600,key,vel:0.8,channel:1}]}],
    plugins:[{id:"t1:synth",type:"4osc",name:"synth",role:"instrument"}] }] });
const send = (ws,o) => ws.send(JSON.stringify(o));
const ws = new WebSocket("ws://127.0.0.1:8833");
ws.on("open", () => {
  // DEUX sessions distinctes, chacune son projet, chacune son transport.
  send(ws, { type:"project", session:"st0",    doc: doc("depuis-st0", 45) });
  send(ws, { type:"project", session:"m9", doc: doc("depuis-m9", 64) });
  setTimeout(() => { send(ws,{type:"transport",session:"st0",action:"play"});
                     send(ws,{type:"transport",session:"m9",action:"play"}); }, 2500);
  // Chaque session ecoute la SIENNE, sur sa propre socket.
  const counts = { st0: 0, m9: 0 };
  for (const sid of ["st0", "m9"]) {
    const l = new WebSocket("ws://127.0.0.1:8833");
    l.binaryType = "arraybuffer";
    l.on("open", () => l.send(JSON.stringify({ type: "broadcast", session: sid, on: true })));
    l.on("message", (d, bin) => { if (bin) counts[sid]++; });
  }
  setTimeout(() => {
    console.log("trames recues par session :", counts);
    const ok = counts.st0 > 100 && counts.m9 > 100;
    console.log(ok ? "OK — chaque session recoit son propre flux"
                   : "ECHEC — une session ne recoit rien");
    process.exit(ok ? 0 : 1);
  }, 12000);
});
ws.on("error", e => { console.error(e.message); process.exit(1); });