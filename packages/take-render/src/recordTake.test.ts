// What a finished take becomes on disk. The engine writes a .wav and reports where it landed; everything that
// makes it a CLIP is written here, and a recording is meant to be indistinguishable afterwards from one you
// dropped in by hand — same two files, same fields, nothing that says "this one came from the recorder".

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { loadProject } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addTakeToTrack } from "./recordTake";

let dir: string;

/** 44 bytes of WAV header and no samples — enough to BE a file, which is all this asks of it. */
function wav(path: string): void {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(2, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(192000, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(0, 40);
  writeFileSync(path, b);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-take-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(join(dir, "graph.yaml"), "modules: {}\n", "utf8");
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\n',
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// 120bpm 4/4: a beat is half a second, a bar two. The take starts at bar 3 and runs four bars.
const doc = () => loadProject(dir) as ProjectDoc;
const take = (start = 4, length = 8) => {
  const file = join(dir, "clips", "take-tmp.wav");
  wav(file);
  return { track: "gtr", file, start, length };
};
const clipText = (id: string) =>
  readFileSync(join(dir, "clips", `${id}.yaml`), "utf8");
const trackText = () => readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");

describe("a finished take", () => {
  it("declares its window in full — `from` included, at the file's start", () => {
    // "1:1" is what an absent `from` already means, so this line adds no behaviour. It is written because THIS
    // is the file you open to trim the take, and the two numbers you came to change should be sitting in it at
    // their real values rather than having to be conjured from a blank one.
    const id = addTakeToTrack(dir, doc(), take());
    const text = clipText(id);
    expect(text).toContain('from: "1:1"');
    expect(text).toContain('to: "5:1"'); // 8s at 120bpm == 16 beats == four bars in
  });

  it("writes those as POSITIONS in the file, not durations", () => {
    // The trap this pins: read as a duration, "5:1" would be five bars and a beat and the take would keep a
    // second of whatever followed it. `to` is where the window closes, measured from `from`'s own "1:1".
    const id = addTakeToTrack(dir, doc(), take(0, 2)); // two seconds == four beats == one bar
    expect(clipText(id)).toContain('to: "2:1"');
  });

  it("quotes them, so a reload can't read them as sexagesimal numbers", () => {
    const id = addTakeToTrack(dir, doc(), take());
    expect(clipText(id)).not.toMatch(/(from|to): \d+:/);
  });

  it("places it with a start and nothing else", () => {
    // No length on the placement: the clip's window says how long it sounds, and a second answer here could
    // only ever disagree with it.
    addTakeToTrack(dir, doc(), take());
    expect(trackText()).toContain('start: "3:1"');
    expect(trackText()).not.toContain("length");
    expect(trackText()).not.toContain("offset");
  });

  it("compiles to a clip that plays exactly the take", () => {
    // The two halves agreeing: the files above, read back through the compiler the engine is fed from.
    const id = addTakeToTrack(dir, doc(), take());
    const clip = loadProject(dir).tracks.find((t) => t.id === "gtr")!.clips[0];
    // The MATERIAL the take wrote. `id` identifies the PLACEMENT now (`<ref>@<start>`), so a
    // take's own name is what `name` carries — see @studio/song's placementId.
    expect(clip.name).toBe(id);
    expect(clip.start).toBe(8); // bar 3 == 8 beats in
    expect(clip.sourceTo).toBeCloseTo(8, 6); // eight seconds of source
    expect(clip.sourceFrom).toBeUndefined(); // "1:1" trims nothing
  });

  it("names the file after the track and the bar it landed on", () => {
    const id = addTakeToTrack(dir, doc(), take());
    expect(id).toMatch(/^gtr_3\.1_\d{6}T\d{6}$/);
    expect(clipText(id)).toContain(`source: clips/${id}.wav`);
  });

  it("refuses a take whose file isn't there", () => {
    // A clip whose wav is missing fails the whole compile — better to refuse the edit than to write a song that
    // no longer loads.
    const t = { ...take(), file: join(dir, "clips", "gone.wav") };
    expect(() => addTakeToTrack(dir, doc(), t)).toThrow(/missing/);
  });
});
