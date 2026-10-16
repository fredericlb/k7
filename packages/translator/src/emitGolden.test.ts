// One song exercising every branch of emitFolder, its whole output pinned byte for byte. It is what
// holds the emitter's split files to the output they produced as one.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitFolder } from "./emit";
import type { PluginOut, Song } from "./model";

const plug = (
  name: string,
  role: string,
  extra: Partial<PluginOut> = {},
): PluginOut => ({ type: "vst3", name, role, enabled: true, ...extra });

const SONG: Song = {
  project: {
    name: "golden",
    tempo: 98,
    sampleRate: 48000,
    timeSignature: "7/8",
  },
  tracks: [
    {
      id: "t1",
      name: "Drums",
      role: "regular",
      color: "#ff0000",
      drums: true,
      clips: [
        {
          type: "midi",
          start: 0,
          length: 4,
          notes: [
            { time: 0, duration: 0.5, key: 36, vel: 1, channel: 0, rel: 0 },
            { time: 1, duration: 0.5, key: 38, vel: 0.6, channel: 0, rel: 0 },
          ],
        },
      ],
    },
    {
      id: "t2",
      name: "Keys",
      role: "regular",
      plugins: [
        plug("Pro-Q 3", "audioFX", {
          params: { Gain: 0.5 },
          paramsComplete: true,
        }),
        plug("Diva", "instrument", {
          params: { Cutoff: 0.3 },
          paramsComplete: true,
        }),
        plug("Arp", "noteFX", { enabled: false }),
      ],
      sends: [{ to: "t5", level: 0.5, enabled: true }],
      clips: [
        {
          type: "midi",
          start: 8,
          length: 8,
          loopStart: 0,
          loopEnd: 4,
          disabled: true,
          notes: [
            { time: 0, duration: 1, key: 60, vel: 1, channel: 0, rel: 0 },
          ],
        },
      ],
    },
    {
      id: "t3",
      name: "Bass",
      role: "regular",
      mute: true,
      plugins: [
        plug("Pro-Q 3", "audioFX", {
          path: "plugins/bassq.vstpreset",
          params: { Gain: 0.1 },
        }),
        plug("Diva", "instrument"),
      ],
      clips: [
        {
          type: "audio",
          source: "audio/bass.wav",
          start: 0,
          length: 4,
          fadeIn: 0.25,
        },
        {
          type: "audio",
          source: "audio/bass copy.wav",
          start: 4,
          length: 4,
          offset: 1,
          fadeOut: 0.5,
          warp: {
            algorithm: "complex",
            markers: [
              [0, 0],
              [4, 2.1],
            ],
          },
        },
        { type: "audio", source: "audio/lost.wav", start: 8, length: 2 },
      ],
    },
    {
      id: "t4",
      name: "Vox",
      role: "regular",
      plugins: [
        plug("Kontakt 7", "audioFX", {
          params: { Mix: 0.5 },
          paramsComplete: true,
        }),
      ],
      sends: [
        { to: "t5", level: 1, enabled: true },
        { to: "t6", level: 0.3, enabled: false },
      ],
      clips: [{ type: "audio", source: "audio/vox.wav", start: 2, length: 2 }],
    },
    {
      id: "t5",
      name: "Verb",
      role: "effect",
      plugins: [plug("ValhallaRoom", "audioFX")],
    },
    {
      id: "t6",
      name: "Dead",
      role: "effect",
      plugins: [plug("ValhallaRoom", "audioFX")],
    },
    {
      id: "t7",
      name: "Master",
      role: "master",
      plugins: [plug("Pro-L 2", "audioFX")],
    },
  ],
};

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-golden-"));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

/** Every file under `root`, by relative path, sorted. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(root, p)] = readFileSync(p, "utf8");
    }
  };
  walk(root);
  return out;
}

describe("emitFolder's whole output", () => {
  it("stays byte-identical for a song that takes every branch", () => {
    const dir = join(ws, "song.k7");
    mkdirSync(dir, { recursive: true });
    const exts = join(ws, "exts.json");
    const names = ["Pro-Q 3", "Diva", "Arp", "ValhallaRoom", "Pro-L 2"];
    writeFileSync(
      exts,
      JSON.stringify({
        entries: [{ plugins: names.map((name) => ({ name, format: "VST3" })) }],
      }),
    );
    const bass = new TextEncoder().encode("RIFFbass");
    const assets = {
      "audio/bass.wav": bass,
      "audio/bass copy.wav": bass,
      "audio/vox.wav": new TextEncoder().encode("RIFFvox"),
      "plugins/bassq.vstpreset": new TextEncoder().encode("VST3preset"),
    };
    const stats = emitFolder(dir, SONG, assets, exts);
    rmSync(exts);
    expect({ stats, files: tree(ws) }).toMatchSnapshot();
  });
});
