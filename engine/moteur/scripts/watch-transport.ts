// watch-transport.ts — where is the transport, and is anything coming out? Observes one
// session's `state` frames and prints the playhead and the master level, without touching the
// document — so it can sit beside a browser that is driving.
// Usage: npx tsx engine/moteur/scripts/watch-transport.ts [session] [seconds] [--play]

import WebSocket from "ws";

const url = process.env.STUDIO_ENGINE_WS ?? "ws://127.0.0.1:8765";
const session = process.argv[2] ?? "st0:fred_parapluie_org";
const seconds = Number(process.argv[3] ?? 6);
const play = process.argv.includes("--play");

const ws = new WebSocket(url);
let frames = 0;
let min = Number.POSITIVE_INFINITY;
let max = 0;
// dB, and SILENCE is a large negative — so the accumulator starts below anything real rather
// than at 0, which is a loud signal and would read as "there was sound" for ever.
let peak = Number.NEGATIVE_INFINITY;
let everPlaying = false;
const levels: Record<string, number> = {};

const seekArg = process.argv.find((a) => a.startsWith("--seek="));

ws.on("open", () => {
  ws.send(JSON.stringify({ session, type: "hello" }));
  if (seekArg)
    setTimeout(
      () =>
        ws.send(
          JSON.stringify({
            session,
            type: "transport",
            action: "seek",
            position: Number(seekArg.slice("--seek=".length)),
          }),
        ),
      300,
    );
  if (play)
    setTimeout(
      () => ws.send(JSON.stringify({ session, type: "transport", action: "play" })),
      800,
    );
});
ws.on("message", (d) => {
  let m: {
    type?: string;
    session?: string;
    playing?: boolean;
    playhead?: number;
    /** dB, not a ratio — see EngineHost::masterState. */
    master?: number;
    levels?: Record<string, number>;
  };
  try {
    m = JSON.parse(d.toString());
  } catch {
    return;
  }
  if (m.type !== "state" || (m.session && m.session !== session)) return;
  frames++;
  if (m.playing) everPlaying = true;
  if (typeof m.playhead === "number") {
    min = Math.min(min, m.playhead);
    max = Math.max(max, m.playhead);
  }
  if (typeof m.master === "number") peak = Math.max(peak, m.master);
  for (const [t, db] of Object.entries(m.levels ?? {}))
    levels[t] = Math.max(levels[t] ?? Number.NEGATIVE_INFINITY, db);
});

setTimeout(() => {
  if (play) ws.send(JSON.stringify({ session, type: "transport", action: "stop" }));
  console.log(
    JSON.stringify(
      {
        session,
        frames,
        everPlaying,
        playhead: { min: min === Number.POSITIVE_INFINITY ? null : min, max },
        advanced: max - (min === Number.POSITIVE_INFINITY ? 0 : min),
        masterPeakDb: peak,
        trackPeakDb: levels,
      },
      null,
      1,
    ),
  );
  ws.close();
  process.exit(0);
}, seconds * 1000);
