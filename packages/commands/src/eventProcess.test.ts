// `event process`: an event whose material another event also plays gets a copy of its clip before
// the bounce — and a bounce that writes nothing puts it back on the material it had.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";
import { otherUsesOf, ownMaterial } from "./verbs/eventProcess";

let root: string;
let dir: string;
const put = (rel: string, bytes: Buffer): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), bytes);
};
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
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
  (wsData(join(dir, "tracks/gtr.k7x")).events as { ref: string }[]).map(
    (e) => e.ref,
  );

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "event-process-"));
  dir = join(root, "song.k7");
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  doc("tracks/gtr.k7x", {
    extends: "@meta/track",
    events: [
      { ref: "riff", start: "1:1" },
      { ref: "riff", start: "3:1" },
      { ref: "solo", start: "5:1" },
    ],
  });
  put("clips/riff.wav", wav());
  put("clips/solo.wav", wav());
  doc("clips/riff.k7x", { source: "clips/riff.wav" });
  doc("clips/solo.k7x", { source: "clips/solo.wav" });
  doc("chains/gtr.k7x", {
    start: true,
    steps: [{ id: "lane-gtr", track: "gtr" }, { to: [{ chain: "MIX" }] }],
  });
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
    expect(wsData(join(dir, "clips/riff-2.k7x"))).toEqual({
      source: "clips/riff.wav",
    });
  });

  it("leaves the event on its material when the bounce writes nothing", async () => {
    const h = testHost({ songPath: dir, project: () => loadProject(dir) });
    await runCommand("event process gtr 3:1 no-such-chain", h, "cli");
    expect(refs()).toEqual(["riff", "riff", "solo"]);
    expect(existsSync(join(dir, "clips/riff-2.k7x"))).toBe(false);
  });

  it("asks for all three arguments", async () => {
    const h = testHost({ songPath: dir, project: () => loadProject(dir) });
    await runCommand("event process gtr 3:1", h, "cli");
    expect(h.lines.refuse.join(" ")).toMatch(/usage: event process/);
  });
});
