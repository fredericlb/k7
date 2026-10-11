// `track delete` — the lane and the chain it starts go; every other chain, and the clips, stay.

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
import type { ProjectDoc } from "@studio/song/project";
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
const AMP = '"@st0/audio/amp"';
const host = () =>
  testHost({
    songPath: dir,
    project: () =>
      ({
        tracks: [
          { id: "gtr", name: "gtr" },
          { id: "bass", name: "bass" },
        ],
        groups: [],
      }) as unknown as ProjectDoc,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-delete-"));
  dir = join(root, "song.st0");
  put(
    "project.yaml",
    "project:\n  name: t\n  tempo: 120\nsoloed: [gtr]\nhighlighted: [gtr, bass]\n",
  );
  put("tracks/gtr.yaml", 'extends: "@meta/track"\nevents: []\n');
  put("tracks/bass.yaml", 'extends: "@meta/track"\nevents: []\n');
  put(
    "chains/gtr.yaml",
    `start: true\nsteps:\n  - { id: lane-gtr, track: gtr }\n  - { id: amp-1, extends: ${AMP} }\n  - to: [ { chain: MIX } ]\n`,
  );
  put(
    "chains/bass.yaml",
    `start: true\nsteps:\n  - { id: lane-bass, track: bass }\n  - { id: amp-2, extends: ${AMP} }\n  - to: [ { chain: MIX } ]\n`,
  );
  put("sequences/gtr-take.yaml", 'from: "1:1"\nto: "2:1"\nnotes: []\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track delete", () => {
  it("removes the lane's file and its whole chain, and leaves the rest", async () => {
    const h = host();
    await runCommand("track delete gtr", h, "cli");
    expect(existsSync(join(dir, "tracks/gtr.yaml"))).toBe(false);
    expect(existsSync(join(dir, "chains/gtr.yaml"))).toBe(false);
    expect(existsSync(join(dir, "chains/bass.yaml"))).toBe(true);
    expect(existsSync(join(dir, "tracks/bass.yaml"))).toBe(true);
    expect(existsSync(join(dir, "sequences/gtr-take.yaml"))).toBe(true);
  });

  it("drops the lane from project.yaml's lists", async () => {
    await runCommand("track delete gtr", host(), "cli");
    const root = parse(readFileSync(join(dir, "project.yaml"), "utf8"));
    expect(root.soloed).toBeUndefined();
    expect(root.highlighted).toEqual(["bass"]);
  });

  it("refuses a track that is not there", async () => {
    const h = host();
    await runCommand("track delete nope", h, "cli");
    expect(h.lines.refuse.join(" ")).toContain('no track "nope"');
    expect(existsSync(join(dir, "chains/gtr.yaml"))).toBe(true);
  });
});
