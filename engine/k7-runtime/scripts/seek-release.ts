// seek-release.ts — does a SEEK while playing end what was sounding, notes and tails, on every
// non-VST instrument and tail effect? Point it at a running engine.
//
//   npx tsx engine/k7-runtime/scripts/seek-release.ts [ws://127.0.0.1:8765]
//
// Each case plays one note far longer than the run, seeks into empty timeline, and reads the level
// after. A tail case is also stopped instead, which KEEPS the tail: that is what proves the case has
// one to clear (docs/panic.md). It measures a level, never a sound.

import WebSocket from "ws";

const url =
  process.argv.find((a) => a.startsWith("ws://")) ?? "ws://127.0.0.1:8765";
const RATE = 48000;
/** Longer than the run, so no note-off ever arrives on its own. */
const HELD_BEATS = 64;
/** Far past the note, where the timeline is empty. */
const SEEK_TO = 120;

type Plugin = { type: string; name: string; role: string; params?: Record<string, number>; faustDsp?: string };

const FAUST_SYNTH = `import("stdfaust.lib");
process = os.sawtooth(hslider("freq", 440, 20, 4000, 1)) * hslider("gain", 0.5, 0, 1, 0.01)
  * en.adsr(0.01, 0.1, 0.8, 0.3, button("gate")) * 0.5 <: _, _;`;
const FAUST_ECHO = `import("stdfaust.lib");
process = par(i, 2, ef.echo(2.0, 0.37, 0.92));`;

const synth: Plugin = { type: "4osc", name: "4OSC", role: "instrument" };

/** `tail`: its tail outlives a stop, so a stop is measured as the control; `early`: it decays on its own, so it is read soon after play. */
const CASES: { name: string; plugins: Plugin[]; tail?: boolean; early?: boolean }[] = [
  { name: "4osc", plugins: [synth] },
  { name: "faust instrument", plugins: [{ type: "studio_faust", name: "Faust", role: "instrument", faustDsp: FAUST_SYNTH }] },
  { name: "mu-tides", plugins: [{ type: "studio_tidal_modulator", name: "mu-tides", role: "instrument" }] },
  { name: "mu-plaits", plugins: [{ type: "studio_macro_oscillator_2", name: "mu-plaits", role: "instrument" }] },
  { name: "mu-rings", plugins: [{ type: "studio_resonator", name: "mu-rings", role: "instrument", params: { damping: 0.95 } }], tail: true, early: true },
  { name: "mu-elements", plugins: [{ type: "studio_modal_synthesizer", name: "mu-elements", role: "instrument", params: { bowLevel: 0.8, space: 1.5 } }], early: true },
  { name: "mu-peaks", plugins: [{ type: "studio_drum_voices", name: "mu-peaks", role: "instrument" }], early: true },
  { name: "mu-braids", plugins: [{ type: "studio_macro_oscillator", name: "mu-braids", role: "instrument" }] },
  { name: "arpeggiator → 4osc", plugins: [{ type: "studio_arpeggiator", name: "Arpeggiator", role: "midiEffect" }, synth] },
  { name: "4osc → reverb", plugins: [synth, { type: "reverb", name: "Reverb", role: "effect", params: { roomSize: 1, damping: 0 } }], tail: true },
  { name: "4osc → delay", plugins: [synth, { type: "delay", name: "Delay", role: "effect", params: { feedback: -1 } }], tail: true },
  { name: "4osc → faust echo", plugins: [synth, { type: "studio_faust", name: "Faust", role: "effect", faustDsp: FAUST_ECHO }], tail: true },
  { name: "4osc → mu-clouds", plugins: [synth, { type: "studio_texture_synthesizer", name: "mu-clouds", role: "effect", params: { dryWet: 1, reverb: 1, feedback: 0.8 } }], tail: true },
];

const doc = (plugins: Plugin[]) => ({
  name: "seek-release",
  tempo: 120,
  sampleRate: RATE,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0,
  masterPlugins: [],
  recordDir: "",
  settings: { metronome: false, countIn: 0 },
  groups: [],
  markers: [],
  tracks: [
    {
      id: "lane",
      name: "lane",
      role: "regular",
      contentType: "midi",
      group: "",
      generated: false,
      color: "",
      mute: false,
      solo: false,
      disabled: false,
      inputChannels: [],
      outputChannels: [],
      monitor: "auto",
      inputGain: 0,
      clips: [
        {
          id: "held",
          type: "midi",
          name: "held",
          source: "",
          start: 0,
          length: HELD_BEATS,
          offset: 0,
          fadeIn: 0,
          fadeOut: 0,
          loopStart: 0,
          loopEnd: 0,
          notes: [{ time: 0, duration: HELD_BEATS, key: 57, vel: 0.9, channel: 1, rel: 0 }],
        },
      ],
      plugins: plugins.map((p, i) => ({
        id: `lane:${i}`,
        path: "",
        presetSave: "",
        enabled: true,
        params: {},
        ...p,
      })),
      sends: [],
      automation: [],
    },
  ],
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (db: number) => `${db.toFixed(1).padStart(7)} dBFS`;

/** One case on its own session: the level while playing, after a seek, and after a stop. */
async function run(name: string, plugins: Plugin[], tail: boolean, early: boolean) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const session = `m9:seek-release:${name}`;
  const send = (m: Record<string, unknown>) => ws.send(JSON.stringify({ ...m, session }));
  let sum = 0;
  let count = 0;
  const reset = () => {
    sum = 0;
    count = 0;
  };
  const rmsDb = () => (count ? 20 * Math.log10(Math.sqrt(sum / count) || 1e-9) : -Infinity);
  ws.on("message", (data: ArrayBuffer | Buffer, isBinary: boolean) => {
    if (!isBinary) return;
    const buf =
      data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== 0x4c535452) return;
    const channels = dv.getUint8(5);
    const frames = dv.getUint32(12, true);
    const all = new Float32Array(buf, 32, frames * channels);
    for (let i = 0; i < all.length; i++) sum += all[i] * all[i];
    count += all.length;
  });
  await new Promise<void>((ok, ko) => {
    ws.on("open", () => ok());
    ws.on("error", ko);
  });

  send({ type: "project", doc: doc(plugins) });
  send({ type: "broadcast", on: true });
  // The first apply builds the plugins — a Faust program compiles here.
  await wait(3000);

  // A window that opens 0.4 s after the move: past a release, well inside any reverb worth the name.
  const measureAfter = async (move: Record<string, unknown>) => {
    send({ type: "transport", action: "rewind" });
    send({ type: "transport", action: "play" });
    // A struck resonator decays on its own: it is measured early, while it still rings.
    await wait(early ? 100 : 1500);
    reset();
    await wait(early ? 300 : 800);
    const playing = rmsDb();
    send({ type: "transport", ...move });
    await wait(400);
    reset();
    await wait(800);
    return { playing, after: rmsDb() };
  };

  const seek = await measureAfter({ action: "seek", position: SEEK_TO });
  send({ type: "transport", action: "stop" });
  await wait(4000);
  const stop = tail ? await measureAfter({ action: "stop" }) : null;

  send({ type: "broadcast", on: false });
  send({ type: "drop-session" });
  await wait(200);
  ws.close();

  // 40 dB under the note is silence for this question; a held note or a live tail sits far above it.
  const sounded = seek.playing > -70;
  const cleared = seek.after < seek.playing - 40;
  // A stop keeps the tail: if it is gone after a stop too, the case had nothing to clear.
  const hadTail = stop ? stop.after > seek.after + 20 : true;
  // A seek that broke the plugin would pass the seek check by silence alone: the replay has to sound too.
  const recovered = stop ? stop.playing > seek.playing - 6 : true;
  const ok = sounded && cleared && hadTail && recovered;
  console.log(
    `${ok ? "OK   " : "ECHEC"} ${name.padEnd(20)} playing ${fmt(seek.playing)}   after seek ${fmt(seek.after)}` +
      (stop ? `   replayed ${fmt(stop.playing)}   after stop ${fmt(stop.after)}` : "") +
      (!sounded ? "   (never sounded)" : !recovered ? "   (silent after the seek)" : !hadTail ? "   (no tail to clear)" : ""),
  );
  return ok;
}

(async () => {
  let failed = 0;
  for (const c of CASES) if (!(await run(c.name, c.plugins, c.tail ?? false, c.early ?? false))) failed++;
  console.log(failed ? `${failed} case(s) failed` : "every case let go on a seek");
  process.exit(failed ? 1 : 0);
})();
