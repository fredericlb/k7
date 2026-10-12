// `event loop` and `event loop points`, through the dispatcher on a chain project with real files: the switch
// gives an unbounded audio event its file's length, the compile then loops it, and moving the points keeps
// the event's length on the lane in either material's unit.

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
  root = mkdtempSync(join(tmpdir(), "evloop-"));
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

describe("event loop", () => {
  it("loops an audio event that states no end, writing its file's length as one", async () => {
    const h = await run("event loop gtr 1:1 on");
    expect(h.lines.refuse).toEqual([]);
    expect(events("gtr")[0]).toMatchObject({ to: 10, loop: 2 });
    // Two passes of ten seconds, in beats — the compile accepts the event's own `to` as the window's end.
    expect(clipOf("gtr")?.length).toBe(40);
  });

  it("toggles, and off deletes the key", async () => {
    await run("event loop keys 1:1");
    expect(events("keys")[0].loop).toBe(2);
    await run("event loop keys 1:1");
    expect(events("keys")[0].loop).toBeUndefined();
  });
});

describe("event loop points", () => {
  it("moves an audio loop in seconds, its length on the lane kept", async () => {
    await run("event loop gtr 1:1 on");
    const h = await run("event loop points gtr 1:1 2 6");
    expect(h.lines.refuse).toEqual([]);
    // 40 beats on the lane, a 4 s (8 beat) window: five passes.
    expect(events("gtr")[0]).toMatchObject({ from: 2, to: 6, loop: 5 });
    expect(clipOf("gtr")?.length).toBe(40);
  });

  it("moves a sequence loop in beats, written as positions, the compile looping exactly that", async () => {
    await run("event loop keys 1:1 on");
    await run("event loop points keys 1:1 4 8");
    expect(events("keys")[0]).toMatchObject({
      from: "2:1",
      to: "3:1",
      loop: 8,
    });
    const c = clipOf("keys");
    expect(c).toMatchObject({ loopStart: 4, loopEnd: 8, length: 32 });
  });

  it("refuses points that run backwards, writing nothing", async () => {
    const h = await run("event loop points keys 1:1 8 4");
    expect(h.lines.refuse.join(" ")).toMatch(/running forwards/);
    expect(events("keys")[0].from).toBeUndefined();
  });
});
