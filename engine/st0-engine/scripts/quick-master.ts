// quick-master.ts — what `QuickMasterPlugin` claims about a SOUND, rendered and measured.
//
// Three claims no TypeScript test can see, because the plugin needs a live te::Edit and the
// four C++ suites build none (see AGENTS.md): the ceiling really is a ceiling, a width of 0
// really collapses the image, and the three bands really sum back to the signal that went in.
//   npx tsx engine/st0-engine/scripts/quick-master.ts

import { readFileSync, statSync } from "node:fs";
import { renderProject } from "../../../packages/file-service/src/render.ts";

/** The knobs a run overrides, on top of the plugin's own neutral defaults. */
type Knobs = Record<string, number>;

// A loud sustained note, hard-panned by a second track; 4osc needs no file on disk.
function doc(params: Knobs | null, keys: [number, number] = [45, 52]) {
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
      // Panned hard apart for a SIDE signal, and down 12 dB for headroom (../docs/renderHarnesses.md).
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
    tracks: [track("t1", keys[0], -1), track("t2", keys[1], 1)],
    // The DISPLAY name is how a doc names a built-in — see ../docs/renderHarnesses.md.
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
  // Walk the RIFF chunks rather than assuming a 44-byte header (../docs/renderHarnesses.md).
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

  // Both formats rather than one: a harness failing on the render's own format says nothing.
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
  // Samples OFF the 16-bit grid, give or take the one 24-bit step JUCE's writer loses scaling by 2^23−1, not 2^23.
  let offGrid16 = 0;
  for (let i = dataAt; i + bytes * chans <= dataAt + dataLen; i += bytes * chans) {
    const l = sample(i);
    const r = chans > 1 ? sample(i + bytes) : l;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    for (const x of [l, r]) {
      const v = Math.round(x * 8388608);
      if (Math.abs(v - Math.round(v / 256) * 256) > 1) offGrid16++;
    }
    mid += ((l + r) / 2) ** 2;
    side += ((l - r) / 2) ** 2;
    n++;
  }
  return {
    peak,
    mid: Math.sqrt(mid / n),
    side: Math.sqrt(side / n),
    offGrid16,
  };
}

async function run(
  label: string,
  params: Knobs | null,
  keys?: [number, number],
) {
  const out = await renderProject(doc(params, keys) as never);
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
  // 1. NEUTRAL — the defaults do nothing audible, so a module may drop one into a chain.
  const bare = await run("no plugin", null);
  const neutral = await run("neutral", {});

  // 2. THE CEILING, at the FLOOR of its own range with 12 dB of drive (../docs/renderHarnesses.md).
  const ceiling = await run("ceiling −12 dB", { Ceiling: -12, Drive: 12 });

  // 3. THE IMAGE, as the side/mid RATIO rather than the side alone (../docs/renderHarnesses.md).
  const mono = await run("width 0", { Width: 0 });

  // …and the other way, which is the half that is easy to get backwards.
  const wide = await run("width 180", { Width: 180 });
  const ratio = (m: { mid: number; side: number }) => m.side / Math.max(m.mid, 1e-9);

  // 5. THE OUTPUT WORD LENGTH — Righteous 4's, after the limiter (../docs/quickMaster.md).
  const word16 = await run("output 16-bit", { Output: 2 });
  const word16Ceiling = await run("16-bit, ceiling −12", { Output: 2, Ceiling: -12, Drive: 12 });

  // 6. TO VINYL 4's TWO STAGES: the mid's low cut, and the HF limit (../docs/quickMaster.md).
  const cut = await run("low cut 150 Hz", { "Low Cut": 150 });
  // HIGH notes: the HF limit acts on a fast-bending wave, which the low pair above never is.
  const HIGH: [number, number] = [96, 103];
  const bright = await run("high notes, neutral", {}, HIGH);
  const tamed = await run("high notes, HF limit 100%", { "HF Limit": 100 }, HIGH);
  const lowTamed = await run("low notes, HF limit 100%", { "HF Limit": 100 });

  // 4. THE BANDS SUM — the LR4 allpass correction in splitBands (../docs/renderHarnesses.md).
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
      "float output stays off the 16-bit grid",
      neutral.offGrid16 > 0,
      `${neutral.offGrid16} samples between 16-bit steps — the check below can fail`,
    ],
    [
      "16-bit output lands on the 16-bit grid",
      word16.offGrid16 === 0,
      `${word16.offGrid16} samples between 16-bit steps`,
    ],
    [
      "the ceiling holds with the word length on",
      db(word16Ceiling.peak) <= -12 + 0.05,
      `peak ${db(word16Ceiling.peak).toFixed(2)} dBFS, ceiling −12`,
    ],
    [
      "the low cut thins the mid",
      db(cut.mid) - db(neutral.mid) < -3,
      `mid ${(db(cut.mid) - db(neutral.mid)).toFixed(2)} dB against neutral`,
    ],
    [
      "…and leaves the side to Bass Mono",
      Math.abs(db(cut.side) - db(neutral.side)) < 0.5,
      `side ${(db(cut.side) - db(neutral.side)).toFixed(2)} dB against neutral`,
    ],
    [
      "the HF limit pulls the high notes down",
      db(tamed.mid) - db(bright.mid) < -0.2,
      `mid ${(db(tamed.mid) - db(bright.mid)).toFixed(2)} dB against the same notes neutral`,
    ],
    [
      "…and leaves the low ones alone",
      Math.abs(db(lowTamed.mid) - db(neutral.mid)) < 0.05,
      `mid ${(db(lowTamed.mid) - db(neutral.mid)).toFixed(2)} dB against neutral`,
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
