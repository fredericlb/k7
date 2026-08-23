// quick-master.ts — what `QuickMasterPlugin` claims about a SOUND, rendered and measured.
//
// Three claims no TypeScript test can see, because the plugin needs a live te::Edit and the
// four C++ suites build none (see AGENTS.md): the ceiling really is a ceiling, a width of 0
// really collapses the image, and the three bands really sum back to the signal that went in.
//   npx tsx engine/moteur/scripts/quick-master.ts

import { readFileSync, statSync } from "node:fs";
import { renderProject } from "../../../packages/file-service/src/render.ts";

/** The knobs a run overrides, on top of the plugin's own neutral defaults. */
type Knobs = Record<string, number>;

// A loud sustained note, hard-panned by a second track, so there is something to limit and
// something to narrow. 4osc because it is the one instrument that needs no file on disk.
function doc(params: Knobs | null) {
  const note = (key: number) => ({
    id: `c${key}`,
    type: "midi",
    name: "t",
    start: 0,
    length: 2,
    notes: [{ time: 0, duration: 2, key, vel: 1, channel: 1 }],
  });
  const track = (id: string, key: number, pan: number) => ({
    id,
    name: id,
    clips: [note(key)],
    plugins: [
      { id: `${id}:synth`, type: "4osc", name: "synth", role: "instrument" },
      // Panned hard apart, which is what gives the render a SIDE signal to widen or collapse,
      // and turned DOWN 12 dB. The headroom is the whole point: the bounce is 24-bit PCM, so a
      // hot render clips at the format and every measurement below would then be comparing two
      // clipped waveforms. At −12 the plugin's default ceiling never engages, which is what
      // makes "neutral leaves the mix alone" a real claim rather than an artefact.
      {
        id: `${id}:mix`,
        type: "studio_mixer",
        name: "mix",
        role: "audioFX",
        params: { Pan: pan, Volume: -12 },
      },
    ],
  });
  return {
    name: "quickmaster",
    tempo: 120,
    sampleRate: 48000,
    timeSigNumerator: 4,
    timeSigDenominator: 4,
    recordDir: "",
    settings: { metronome: false, countIn: 0 },
    groups: [],
    tracks: [track("t1", 45, -1), track("t2", 52, 1)],
    // `internal` + the DISPLAY name is how a doc names a built-in: enginePlugin() turns it into
    // `{ type: "Quick Master" }` and resolveBuiltInType matches it to studio_quickmaster.
    masterPlugins: params
      ? [
          {
            id: "master:qm",
            type: "Quick Master",
            name: "Quick Master",
            role: "audioFX",
            params,
          },
        ]
      : [],
  };
}

/** Peak and mid/side energy of a rendered stereo float wav. */
function measure(file: string): { peak: number; side: number; mid: number } {
  const buf = readFileSync(file);
  // Walk the RIFF chunks rather than assuming a 44-byte header: a float wav carries `fmt ` with
  // an extension and often a `fact` chunk, so the fixed offset lands mid-sample.
  let at = 12;
  let dataAt = -1;
  let dataLen = 0;
  let bits = 32;
  let chans = 2;
  let fmt = 1; // 1 = PCM, 3 = IEEE float
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "fmt ") {
      fmt = buf.readUInt16LE(at + 8);
      chans = buf.readUInt16LE(at + 10);
      bits = buf.readUInt16LE(at + 22);
    } else if (id === "data") {
      dataAt = at + 8;
      dataLen = size;
      break;
    }
    at += 8 + size + (size & 1);
  }
  if (dataAt < 0) throw new Error(`${file}: no data chunk`);

  // The bounce is 24-bit PCM today and was float while this was being written, so the reader
  // takes both rather than pinning one — a harness that fails on the render's own format tells
  // you nothing about the plugin.
  const bytes = bits / 8;
  const full = 2 ** (bits - 1);
  const sample = (i: number): number => {
    if (bits === 32 && fmt === 3) return buf.readFloatLE(i);
    if (bits === 24)
      return ((buf.readUInt8(i) | (buf.readUInt8(i + 1) << 8) | (buf.readInt8(i + 2) << 16)) / full);
    if (bits === 16) return buf.readInt16LE(i) / full;
    if (bits === 32) return buf.readInt32LE(i) / full;
    throw new Error(`${file}: unsupported ${bits}-bit format ${fmt}`);
  };

  let peak = 0;
  let side = 0;
  let mid = 0;
  let n = 0;
  for (let i = dataAt; i + bytes * chans <= dataAt + dataLen; i += bytes * chans) {
    const l = sample(i);
    const r = chans > 1 ? sample(i + bytes) : l;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
    n++;
  }
  return { peak, mid: Math.sqrt(mid / n), side: Math.sqrt(side / n) };
}

async function run(label: string, params: Knobs | null) {
  const out = await renderProject(doc(params) as never);
  const file = out.files[0];
  if (!file || statSync(file).size < 100_000)
    throw new Error(`${label}: the render produced no audio`);
  const m = measure(file);
  console.log(
    `${label.padEnd(22)} peak ${m.peak.toFixed(4)}  mid ${m.mid.toFixed(4)}  side ${m.side.toFixed(4)}`,
  );
  return m;
}

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

async function main() {
  // 1. NEUTRAL. The plugin's own defaults do nothing audible, which is what lets a module drop
  //    one into a chain without changing the mix until somebody turns a knob.
  const bare = await run("no plugin", null);
  const neutral = await run("neutral", {});

  // 2. THE CEILING. −12 dB with 12 dB of drive — 18 dB of limiting, far more than a one-pole
  //    attack can take off a transient, so this is the safety clipper's claim as much as the
  //    limiter's. A peak above the ceiling here means the ceiling is an intention.
  //
  //    −12 is the FLOOR of the parameter's own range, and asking for less is how this line
  //    lied for one run: an out-of-range value is clamped by the AutomatableParameter, so
  //    `Ceiling: -18` measured −12 dBFS and read as a limiter 6 dB out.
  const ceiling = await run("ceiling −12 dB", { Ceiling: -12, Drive: 12 });

  // 3. THE IMAGE, measured as the side/mid RATIO rather than as the side alone. The limiter
  //    sits after the spreader, so widening can push into it and pull the whole render down —
  //    an absolute side level would then read a wider image as a narrower one.
  const mono = await run("width 0", { Width: 0 });
  //    …and the other way, which is the half that is easy to get backwards.
  const wide = await run("width 180", { Width: 180 });
  const ratio = (m: { mid: number; side: number }) => m.side / Math.max(m.mid, 1e-9);

  // 4. THE BANDS SUM. Three amounts at zero and the split still runs — this is the LR4 allpass
  //    correction in splitBands. Without it there is a several-dB notch around the low corner,
  //    which shows up here as a neutral render quieter than the bare one.
  const neutralDb = db(neutral.peak) - db(bare.peak);

  const checks: [string, boolean, string][] = [
    [
      "the bare render has headroom",
      bare.peak < 0.95,
      `peak ${db(bare.peak).toFixed(2)} dBFS — above this the 24-bit bounce clips and every line below compares two clipped waveforms`,
    ],
    [
      "neutral defaults leave the mix alone",
      Math.abs(neutralDb) < 0.5,
      `${neutralDb.toFixed(2)} dB against the bare render`,
    ],
    [
      "the ceiling holds",
      db(ceiling.peak) <= -12 + 0.05,
      `peak ${db(ceiling.peak).toFixed(2)} dBFS, ceiling −12`,
    ],
    [
      "width 0 collapses the side",
      ratio(mono) < 0.02,
      `side/mid ${ratio(mono).toFixed(4)} against ${ratio(bare).toFixed(4)}`,
    ],
    [
      "width 0 keeps the mid",
      Math.abs(db(mono.mid) - db(bare.mid)) < 0.5,
      `mid ${db(mono.mid).toFixed(2)} against ${db(bare.mid).toFixed(2)} dB`,
    ],
    [
      "width 180 widens rather than narrows",
      ratio(wide) > ratio(bare) * 1.5,
      `side/mid ${ratio(wide).toFixed(4)} against ${ratio(bare).toFixed(4)}`,
    ],
  ];

  let bad = 0;
  for (const [what, ok, detail] of checks) {
    console.log(`${ok ? "OK   " : "ECHEC"} ${what} — ${detail}`);
    if (!ok) bad++;
  }
  process.exit(bad ? 1 : 0);
}

void main();
