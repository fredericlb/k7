// `event gain`, through the dispatcher on a chain project with real files: an audio event's trim is written to
// a tenth of a dB and compiled onto its clip, unity deletes it, and a MIDI event — which has none — is refused.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string | Buffer): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const events = (lane: string) =>
  parse(readFileSync(join(dir, `tracks/${lane}.yaml`), "utf8")).events;
const clipOf = (lane: string) =>
  loadProject(dir).tracks.find((t) => t.id === lane)?.clips[0];
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};

/** `seconds` of silence as a 16-bit mono WAV at 8 kHz — enough for the length to be read. */
function wav(seconds: number): Buffer {
  const data = Math.round(seconds * 8000) * 2;
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(data, 40);
  return b;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "evgain-"));
  dir = join(root, "song.st0");
  // 120 bpm: a beat is half a second.
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put("clips/a.wav", wav(10));
  put("clips/a.yaml", "source: clips/a.wav\n");
  const notes = Array.from(
    { length: 16 },
    (_, i) => `  - { t: ${i}, d: 1, k: 60 }`,
  );
  put("sequences/pat.yaml", `notes:\n${notes.join("\n")}\n`);
  put(
    "tracks/gtr.yaml",
    'extends: "@meta/track"\nevents:\n  - { ref: a, start: "1:1" }\n',
  );
  put(
    "tracks/keys.yaml",
    'extends: "@meta/track"\nevents:\n  - { ref: pat, start: "1:1" }\n',
  );
  for (const lane of ["gtr", "keys"])
    put(
      `chains/${lane}.yaml`,
      `start: true\nsteps:\n  - { id: lane-${lane}, track: ${lane} }\n  - to: [ { chain: MIX } ]\n`,
    );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("event gain", () => {
  it("writes an audio event's trim and compiles it onto its clip", async () => {
    const h = await run("event gain gtr 1:1 -1.54");
    expect(h.lines.refuse).toEqual([]);
    expect(events("gtr")[0].gain).toBe(-1.5);
    expect(clipOf("gtr")?.gainDb).toBe(-1.5);
  });

  it("deletes the key at unity, so the clip carries none", async () => {
    await run("event gain gtr 1:1 3");
    await run("event gain gtr 1:1 0");
    expect(events("gtr")[0].gain).toBeUndefined();
    expect(clipOf("gtr")?.gainDb).toBeUndefined();
  });

  it("refuses a MIDI event, and a trim past six dB, writing nothing", async () => {
    const midi = await run("event gain keys 1:1 2");
    expect(midi.lines.refuse.join(" ")).toMatch(/MIDI/);
    expect(events("keys")[0].gain).toBeUndefined();
    const far = await run("event gain gtr 1:1 7");
    expect(far.lines.refuse.join(" ")).toMatch(/-6 to \+6/);
    expect(events("gtr")[0].gain).toBeUndefined();
  });

  it("reports a gain hand-written on a MIDI event rather than ignoring it", () => {
    put(
      "tracks/keys.yaml",
      'extends: "@meta/track"\nevents:\n  - { ref: pat, start: "1:1", gain: 2 }\n',
    );
    expect(() => loadProject(dir)).toThrow(/only an audio event has/);
  });
});
