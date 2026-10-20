// probe.ts — what the live-engine probes share, and not a probe itself: the socket to a running
// engine, the master stream's level, and the one-lane document most of them play.
//
// The document is built from @studio/engine-protocol's constructors, so a field the wire gains
// reaches every probe at once instead of going missing from a dozen hand-written literals.

import { clipDoc, emptyDoc, pluginDoc, trackDoc } from "@studio/engine-protocol/build";
import type { PluginDoc, ProjectDoc } from "@studio/engine-protocol/project";
import WebSocket from "ws";

/** The engine a probe talks to: the first `ws://` argument, else the default local one. */
export const engineUrl = (): string =>
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A level as the probes print it. */
export const fmtDb = (db: number) => `${db.toFixed(1)} dBFS`;

/** A socket bound to one session: every message sent carries it. `opened` resolves on connect and exits on a socket error. */
export function connect(session: string, url = engineUrl()) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const send = (m: Record<string, unknown>) => ws.send(JSON.stringify({ ...m, session }));
  const opened = new Promise<void>((ok) => {
    ws.on("open", () => ok());
    ws.on("error", (e: Error) => {
      console.error("socket:", e.message);
      process.exit(1);
    });
  });
  return { ws, send, opened };
}

/** The RMS of every master-stream (`LSTR`) frame since the last `reset`, so each phase measures only itself. */
export function meter(ws: WebSocket) {
  let sum = 0;
  let count = 0;
  ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    const buf =
      data instanceof ArrayBuffer
        ? data
        : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4c535452) return;
    const channels = dv.getUint8(5);
    const frames = dv.getUint32(12, true);
    const all = new Float32Array(buf, 32, frames * channels);
    for (let i = 0; i < all.length; i++) sum += all[i] * all[i];
    count += all.length;
  });
  const reset = () => {
    sum = 0;
    count = 0;
  };
  const rmsDb = () => (count ? 20 * Math.log10(Math.sqrt(sum / count) || 1e-9) : -Infinity);
  /** Let the level settle for `settle` ms, then read it over the next `window` ms. */
  const measure = async (settle = 700, window = 1000) => {
    await wait(settle);
    reset();
    await wait(window);
    return rmsDb();
  };
  return { reset, rmsDb, measure };
}

/** mu-tides, the synth most probes play their held note into. */
export const TIDES = pluginDoc({
  id: "lane:tides",
  type: "studio_tidal_modulator",
  name: "mu-tides",
  role: "instrument",
});

/** One MIDI lane `lane` holding one note for `beats`, through `plugins` — far longer than a run, so no note-off ever arrives. */
export function heldNoteDoc(name: string, plugins: PluginDoc[], beats = 512): ProjectDoc {
  const held = clipDoc({
    id: "held",
    type: "midi",
    name: "held",
    length: beats,
    notes: [{ time: 0, duration: beats, key: 57, vel: 0.9, channel: 1, rel: 0 }],
  });
  return emptyDoc({
    name,
    tracks: [trackDoc("lane", { contentType: "midi", clips: [held], plugins })],
  });
}
