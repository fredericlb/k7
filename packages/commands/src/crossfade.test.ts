// `event crossfade`, through the dispatcher on a chain project with real files: B pulled earlier into
// what it does not play yet, both events fading over the overlap, and the compile marking the pair.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, bytes: Buffer): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), bytes);
};
const doc = (rel: string, value: unknown): void => writeDoc(join(dir, rel), value);
const events = () =>
  wsData(join(dir, "tracks/gtr.k7x")).events as Record<string, unknown>[];
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
  root = mkdtempSync(join(tmpdir(), "crossfade-"));
  dir = join(root, "song.k7");
  // 120 bpm: a beat is half a second, a bar two seconds.
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  put("clips/a.wav", wav(10));
  put("clips/b.wav", wav(10));
  doc("clips/a.k7x", { source: "clips/a.wav" });
  doc("clips/b.k7x", { source: "clips/b.wav" });
  // A plays 0..4 s from bar 1; B plays 2..6 s of its file from bar 3 — so it has 2 s before its window.
  doc("tracks/gtr.k7x", {
    extends: "@meta/track",
    events: [
      { ref: "a", start: "1:1", to: 4 },
      { ref: "b", start: "3:1", from: 2, to: 6 },
    ],
  });
  doc("chains/gtr.k7x", {
    start: true,
    steps: [{ id: "lane-gtr", track: "gtr" }, { to: [{ chain: "MIX" }] }],
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("event crossfade", () => {
  it("pulls B a beat earlier into its own material, and fades both over the overlap", async () => {
    const h = await run("event crossfade gtr 1:1 3:1 0:1");
    expect(h.lines.refuse).toEqual([]);
    const [a, b] = events();
    expect(b.start).toBe("2:4");
    expect(b.from).toBe(1.5);
    expect(a.fadeOut).toBe("0:1");
    expect(b.fadeIn).toBe("0:1");
    const clips = loadProject(dir).tracks[0].clips;
    expect(clips[0].crossfade).toEqual({ out: true });
    expect(clips[1].crossfade).toEqual({ in: true });
  });

  it("takes the fades away on a length of 0, and keeps the overlap", async () => {
    await run("event crossfade gtr 1:1 3:1 0:1");
    await run("event crossfade gtr 1:1 2:4 0");
    const [a, b] = events();
    expect(a.fadeOut).toBeUndefined();
    expect(b.fadeIn).toBeUndefined();
    expect(b.start).toBe("2:4");
  });
});
