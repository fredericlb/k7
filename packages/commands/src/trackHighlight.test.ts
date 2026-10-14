// `track highlight`: the lane joins `highlighted:`, and its strip plays 10 dB up on its output stage,
// the fader's own Volume untouched — and the second press puts everything back.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIXER_PLUGIN } from "@studio/engine-protocol/build";
import { loadProject } from "@studio/song/project";
import { OUTPUT_VOLUME_PARAM } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const run = async (line: string) => {
  const h = testHost({ songPath: dir, project: () => loadProject(dir) });
  await runCommand(line, h, "cli");
  return h;
};
const strip = () =>
  loadProject(dir).tracks[0].plugins.find((p) => p.type === MIXER_PLUGIN);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-highlight-"));
  dir = join(root, "song.k7");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put("tracks/gtr.yaml", 'extends: "@meta/track"\nevents: []\n');
  put(
    "chains/gtr.yaml",
    'start: true\nsteps:\n  - { id: lane-gtr, track: gtr }\n  - { id: fader, extends: "@meta/audio/mixer", params: { Volume: -3 } }\n  - to: [ { chain: MIX } ]\n',
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track highlight", () => {
  it("plays the lane 10 dB up on its strip's output stage, the fader untouched, and back", async () => {
    // The strip's own stage, at unity until the lane is highlighted.
    expect(strip()?.params[OUTPUT_VOLUME_PARAM] ?? 0).toBe(0);
    const h = await run("track highlight gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(
      parse(readFileSync(join(dir, "project.yaml"), "utf8")).highlighted,
    ).toEqual(["gtr"]);
    expect(strip()?.params[OUTPUT_VOLUME_PARAM]).toBe(10);
    expect(strip()?.params.Volume).toBe(-3);
    expect(loadProject(dir).tracks[0].highlight).toBe(true);

    await run("track highlight gtr");
    expect(
      parse(readFileSync(join(dir, "project.yaml"), "utf8")).highlighted,
    ).toBeUndefined();
    expect(strip()?.params[OUTPUT_VOLUME_PARAM] ?? 0).toBe(0);
    expect(loadProject(dir).tracks[0].highlight).toBeUndefined();
  });

  it("refuses a lane that is not there", async () => {
    const h = await run("track highlight nope");
    expect(h.lines.refuse.join(" ")).toMatch(/no track "nope"/);
  });
});
