// `event process`: an event whose material another event also plays gets a copy of its clip before
// the bounce — and a bounce that writes nothing puts it back on the material it had.

import {
  existsSync,
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
import { otherUsesOf, ownMaterial } from "./verbs/eventProcess";

let root: string;
let dir: string;
const put = (rel: string, text: string | Buffer): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
/** A second of silent 8 kHz mono: the compile wants a real file behind each clip. */
function wav(): Buffer {
  const data = 16000;
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
const refs = () =>
  (
    parse(readFileSync(join(dir, "tracks/gtr.yaml"), "utf8")).events as {
      ref: string;
    }[]
  ).map((e) => e.ref);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "event-process-"));
  dir = join(root, "song.st0");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put(
    "tracks/gtr.yaml",
    'extends: "@meta/track"\nevents:\n  - { ref: riff, start: "1:1" }\n  - { ref: riff, start: "3:1" }\n  - { ref: solo, start: "5:1" }\n',
  );
  put("clips/riff.wav", wav());
  put("clips/solo.wav", wav());
  put("clips/riff.yaml", "source: clips/riff.wav\n");
  put("clips/solo.yaml", "source: clips/solo.wav\n");
  put(
    "chains/gtr.yaml",
    "start: true\nsteps:\n  - { id: lane-gtr, track: gtr }\n  - to: [ { chain: MIX } ]\n",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("event process", () => {
  it("counts the other events on a material, and gives one event its own copy", () => {
    const p = loadProject(dir);
    const [a, , c] = p.tracks[0].clips;
    expect(otherUsesOf(p, "riff", { track: "gtr", id: a.id })).toBe(1);
    expect(otherUsesOf(p, "solo", { track: "gtr", id: c.id })).toBe(0);

    expect(ownMaterial(dir, "gtr", 8, 4, 4, "riff")).toBe("riff-2");
    expect(refs()).toEqual(["riff", "riff-2", "solo"]);
    expect(readFileSync(join(dir, "clips/riff-2.yaml"), "utf8")).toBe(
      "source: clips/riff.wav\n",
    );
  });

  it("leaves the event on its material when the bounce writes nothing", async () => {
    const h = testHost({ songPath: dir, project: () => loadProject(dir) });
    await runCommand("event process gtr 3:1 no-such-chain", h, "cli");
    expect(refs()).toEqual(["riff", "riff", "solo"]);
    expect(existsSync(join(dir, "clips/riff-2.yaml"))).toBe(false);
  });

  it("asks for all three arguments", async () => {
    const h = testHost({ songPath: dir, project: () => loadProject(dir) });
    await runCommand("event process gtr 3:1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/usage: event process/);
  });
});
