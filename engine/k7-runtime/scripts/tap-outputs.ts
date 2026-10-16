// tap-outputs.ts — does a routed tap really LEAVE its instrument? A unit test cannot hear a RackType, so this renders.
// One pad played at a time, on a lane whose instrument routes one pad to pair 1 and a track fed by that pair: a routed
// pad must go silent when its track is muted, and an unrouted one must not. Both instruments: the sampler and an SFZ kit.
//   npx tsx engine/k7-runtime/scripts/tap-outputs.ts
// See engine/k7-runtime/docs/tapOutputs.md.

import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { measureFilePeak } from "../../../packages/audio-analysis/src/peak.ts";
import { findEngineBinary } from "../../../packages/engine-client/src/engineBinary.ts";
import { renderProject } from "../../../packages/file-service/src/render.ts";
import { wavFile } from "./wav.ts";

const base = {
  name: "tap-outputs",
  tempo: 120,
  sampleRate: 48000,
  timeSigNumerator: 4,
  timeSigDenominator: 4,
  masterVolume: 0,
  masterPlugins: [],
  recordDir: "",
  settings: { metronome: false, countIn: 0 },
  groups: [],
};

const SILENT_DB = -60;

/** A half-second sine at `hz`, 16-bit mono, written where the sampler can read it. */
function sine(dir: string, name: string, hz: number): string {
  const rate = 48000;
  const n = rate / 2;
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 16000), i * 2);
  const b = wavFile(pcm, rate, 1, 16);
  const path = join(dir, name);
  writeFileSync(path, b);
  return path;
}

const lane = (plugin: object, key: number) => ({
  id: "kit",
  name: "kit",
  role: "regular",
  contentType: "notes",
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
  clips: [{ id: "c1", type: "midi", name: "t", start: 0, length: 2, notes: [{ time: 0, duration: 1, key, vel: 1, channel: 1 }] }],
  plugins: [plugin],
  sends: [],
  automation: [],
});

/** The track pair 1 feeds — muted or not, which is the whole measurement. */
const fed = (mute: boolean) => ({
  id: "snare-fx",
  name: "snare-fx",
  role: "effect",
  contentType: "audio",
  group: "",
  generated: false,
  color: "",
  mute,
  solo: false,
  disabled: false,
  inputChannels: [],
  outputChannels: [],
  monitor: "auto",
  inputGain: 0,
  clips: [],
  plugins: [],
  sends: [],
  automation: [],
  inputFrom: { plugin: "kit:drums", pair: 1 },
});

async function cases(bin: string, label: string, plugin: (routed: boolean) => object, routedKey: number, otherKey: number) {
  const peak = async (key: number, routed: boolean, fxMuted: boolean) => {
    const out = await renderProject({ ...base, tracks: [lane(plugin(routed), key), fed(fxMuted)] });
    return (await measureFilePeak(out.files[0], { engineBin: bin })).peakDb;
  };
  const rows = [
    ["routed pad, its track open", await peak(routedKey, true, false), "heard"],
    ["routed pad, its track muted", await peak(routedKey, true, true), "silent"],
    ["same pad unrouted, track muted", await peak(routedKey, false, true), "heard"],
    ["other pad, routed kit, track muted", await peak(otherKey, true, true), "heard"],
  ] as const;
  let ok = true;
  console.log(`\n${label}`);
  for (const [what, db, want] of rows) {
    const pass = want === "silent" ? db < SILENT_DB : db > SILENT_DB;
    ok &&= pass;
    console.log(`  ${pass ? "ok  " : "FAIL"} ${what.padEnd(36)} ${Number.isFinite(db) ? db.toFixed(1) : db} dB (want ${want})`);
  }
  return ok;
}

async function main() {
  const bin = findEngineBinary();
  if (!bin) throw new Error("no k7-runtime binary on this machine");
  const dir = mkdtempSync(join(tmpdir(), "tap-outputs-"));
  const low = sine(dir, "low.wav", 110);
  const high = sine(dir, "high.wav", 440);

  const sampler = (routed: boolean) => ({
    id: "kit:drums",
    type: "sampler",
    name: "drums",
    role: "instrument",
    enabled: true,
    params: {},
    rack: [
      { symbol: "Kick", note: 36, clip: low, start: 0, length: 0 },
      { symbol: "Snare", note: 38, clip: high, start: 0, length: 0 },
    ],
    ...(routed ? { tapOuts: [{ note: 38, pair: 1 }] } : {}),
  });
  let ok = await cases(bin, "sampler (k7-rack samples)", sampler, 38, 36);

  const kit = join(homedir(), ".k7", "instruments", "naked-drums", "Wilkinson Audio", "Naked Drums", "User", "Naked Drums GM.sfz");
  const sfz = (routed: boolean) => ({
    id: "kit:drums",
    type: "studio_sfz",
    name: "drums",
    role: "instrument",
    enabled: true,
    params: {},
    sfzFile: kit,
    ...(routed ? { tapOuts: [{ note: 38, pair: 1 }] } : {}),
  });
  ok = (await cases(bin, "SFZ kit (k7-rack naked-drums)", sfz, 38, 36)) && ok;
  console.log(ok ? "\nall cases pass" : "\nSOME CASES FAIL");
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
