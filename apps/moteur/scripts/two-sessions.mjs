// two-sessions.mjs — the proof that two services no longer clobber each other: two
// projects under different session ids on ONE engine, both applied, both playing. Before
// this, the second `project` message tore the first one down. Usage:
//   node apps/moteur/scripts/two-sessions.mjs   (engine on :8833)

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
  send(ws, { type:"project", session:"lanes",    doc: doc("depuis-lanes", 45) });
  send(ws, { type:"project", session:"platines", doc: doc("depuis-platines", 64) });
  setTimeout(() => { send(ws,{type:"transport",session:"lanes",action:"play"});
                     send(ws,{type:"transport",session:"platines",action:"play"}); }, 2500);
  setTimeout(() => { ws.close(); process.exit(0); }, 9000);
});
ws.on("error", e => { console.error(e.message); process.exit(1); });