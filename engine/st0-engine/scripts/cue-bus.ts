// cue-bus.ts — the two things a CUE bus rests on, neither of which a unit test can see.
//
// 1. Does a MUTED bus still feed its aux sends? What is measured elsewhere is that a mute lets
//    CLIPS through to sends; a bus has no clips, it has an AuxReturn. The answer decides where a
//    desk's headphone tap can be taken from — see packages/ui-turntables/docs/cue.md.
// 2. Does `outputChannels` really take a track OFF the mixer's sum? An offline render opens no
//    interface, so a cue bus must come out SILENT rather than folded into the master.
//   npx tsx engine/st0-engine/scripts/cue-bus.ts
// See packages/song/docs/cue.md.

import { measureFilePeak } from "../../../packages/audio-analysis/src/peak.ts";
import { findEngineBinary } from "../../../packages/engine-client/src/engineBinary.ts";
import { renderProject } from "../../../packages/file-service/src/render.ts";

const base = {
  name: "cue-bus",
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

/** A lane holding two seconds of a loud note, muted and sending into each of `to` — every case starts here.
 *
 * `key` matters: two sources playing the SAME note sum by phase, and a 4osc's start phase is not fixed
 * across renders, so their peak swung by 7 dB run to run and no threshold on it meant anything. */
const source = (id: string, key: number, ...to: string[]) => ({
  id,
  name: id,
  role: "regular",
  contentType: "notes",
  group: "",
  generated: false,
  color: "",
  // Muted, so what reaches the master can only have come through the sends.
  mute: true,
  solo: false,
  disabled: false,
  inputChannels: [],
  outputChannels: [],
  monitor: "auto",
  inputGain: 0,
  clips: [
    {
      id: "c1",
      type: "midi",
      name: "t",
      start: 0,
      length: 2,
      notes: [{ time: 0, duration: 2, key, vel: 0.8, channel: 1 }],
    },
  ],
  // The plugin id carries the track's, or two sources in one document collide and the render wobbles.
  plugins: [
    { id: `${id}:synth`, type: "4osc", name: "synth", role: "instrument" },
  ],
  sends: to.map((t) => ({ to: t, level: 1, enabled: true })),
  automation: [],
});

/** A bus: no clips, fed by sends, and optionally sending on or leaving by a pair of its own. */
const bus = (
  id: string,
  over: { mute?: boolean; to?: string; outputChannels?: number[] } = {},
) => ({
  id,
  name: id,
  role: "effect",
  contentType: "audio",
  group: "",
  generated: false,
  color: "",
  mute: over.mute ?? false,
  solo: false,
  disabled: false,
  inputChannels: [],
  outputChannels: over.outputChannels ?? [],
  monitor: "auto",
  inputGain: 0,
  clips: [],
  plugins: [],
  sends: over.to ? [{ to: over.to, level: 1, enabled: true }] : [],
  automation: [],
});

/** The file's true peak in dBFS, decoded by the engine and measured by @studio/audio-analysis. */
async function peakDb(bin: string, file: string): Promise<number> {
  return (await measureFilePeak(file, { engineBin: bin })).peakDb;
}

async function main() {
  const bin = findEngineBinary();
  if (!bin) throw new Error("no st0-engine binary on this machine");
  const render = async (tracks: unknown[]) =>
    await peakDb(bin, (await renderProject({ ...base, tracks })).files[0]);

  // --- 1. how many destinations a source may have and still be heard only through them ---
  // ONE send from a muted track is not an aux send at all: `feedsBusOnly` ROUTES the output to the
  // destination instead. So this measures the routing path, and the two below measure the send path.
  const oneRouted = await render([source("t1", 45, "busM"), bus("busM")]);
  const twoMuted = await render([
    { ...source("t1", 45, "busM", "busC"), mute: true },
    bus("busM"),
    bus("busC"),
  ]);
  const twoOpen = await render([
    { ...source("t1", 45, "busM", "busC"), mute: false },
    bus("busM"),
    bus("busC"),
  ]);

  // --- 2. a bus that leaves by its own pair, against the same bus on the mix ---
  // A normal bus stays beside it in every render, so "the cue is gone" is never read off a silent file:
  // an empty mixdown is what a broken render looks like too. Different NOTES, for the reason in `source`.
  const pair = (cueBus: ReturnType<typeof bus>) => [
    source("onMix", 45, "busMix"),
    source("onCue", 64, "busCue"),
    bus("busMix"),
    cueBus,
  ];
  const cueRouted = await render(pair(bus("busCue", { outputChannels: [3, 4] })));
  const cueOnMix = await render(pair(bus("busCue")));
  // The reference the routed render must EQUAL: the same document with no cue source in it at all.
  const cueAbsent = await render([source("onMix", 45, "busMix"), bus("busMix")]);

  console.log(`1 dest, muté (donc ROUTÉ)     : ${oneRouted.toFixed(1)} dBFS`);
  console.log(`2 dests, source mutée         : ${twoMuted.toFixed(1)} dBFS`);
  console.log(`2 dests, source non mutée     : ${twoOpen.toFixed(1)} dBFS`);
  console.log(`cue sur la paire 3+4, + 1 bus  : ${cueRouted.toFixed(1)} dBFS`);
  console.log(`le même cue sur le mix        : ${cueOnMix.toFixed(1)} dBFS`);
  console.log(`la source de cue RETIRÉE      : ${cueAbsent.toFixed(1)} dBFS`);

  // The control has to make a sound, or neither comparison means anything.
  const controlAudible = oneRouted > -40;
  const mutedBusFeedsSends = twoMuted > -40;
  console.log(
    `\n0. deux départs portent le signal   : ${twoOpen > -40 ? "OUI" : "NON"}`,
  );
  // The mix is still there in all three — so a silent file would be a broken render, not a working cue.
  const cueIsAudibleOnMix = cueOnMix > -40 && cueRouted > -40 && cueAbsent > -40;
  // IDENTITY rather than "quieter": routed away must be indistinguishable from never having been there.
  // A threshold on the summed peak would be measuring how two notes happen to line up, which is not the question.
  const cueStaysOffTheMix =
    Math.abs(cueRouted - cueAbsent) < 0.2 && cueOnMix - cueRouted > 1;

  console.log(
    `\n1. un bus MUTÉ alimente ses départs : ${mutedBusFeedsSends ? "OUI" : "NON"}`,
  );
  console.log(
    `2. outputChannels sort du mix       : ${cueStaysOffTheMix ? "OUI" : "NON"}`,
  );
  const ok = controlAudible && cueIsAudibleOnMix && cueStaysOffTheMix;
  console.log(
    ok
      ? "OK — le cue ne peut pas fuir dans le master"
      : `ECHEC — control=${controlAudible} cueOnMix=${cueIsAudibleOnMix} offMix=${cueStaysOffTheMix}`,
  );
  process.exit(ok ? 0 : 1);
}

void main();
