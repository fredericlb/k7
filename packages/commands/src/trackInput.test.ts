// `track input` — the per-track view's two buttons: an input step put in the lane's chain just ahead of
// the lane, its notes or its sound landing there, and nothing written for a lane that already has one.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGraph } from "@studio/song/graph";
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
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

const AMP = '"@st0/audio/amp"';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-input-"));
  dir = join(root, "song.st0");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put("tracks/keys.yaml", 'extends: "@meta/track"\nevents: []\n');
  put(
    "chains/keys.yaml",
    `start: true\nsteps:\n  - { id: lane-keys, track: keys }\n  - { id: amp-1, extends: ${AMP} }\n  - to: [ { chain: MIX } ]\n`,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track input", () => {
  it("puts a MIDI input ahead of the lane, in the lane's own chain, feeding it", async () => {
    const h = await run("track input keys midi");
    expect(h.lines.refuse).toEqual([]);
    const steps = parse(read("chains/keys.yaml")).steps;
    expect(steps[0].io).toBe("midi");
    expect(steps[1]).toEqual({ id: "lane-keys", track: "keys" });
    const g = loadGraph(dir);
    const feeds = Object.values(g.chains).filter((c) =>
      c.out.some((o) => o.to === "keys"),
    );
    expect(feeds).toHaveLength(1);
  });

  it("puts an audio input there the same way", async () => {
    await run("track input keys audio");
    const first = parse(read("chains/keys.yaml")).steps[0];
    expect(first.io).toBe("in");
    expect(first.monitor).toBe("on");
  });

  it("refuses a second input, writing nothing", async () => {
    await run("track input keys midi");
    const before = read("chains/keys.yaml");
    const h = await run("track input keys audio");
    expect(h.lines.refuse.join(" ")).toContain("already has an input");
    expect(read("chains/keys.yaml")).toBe(before);
  });

  it("refuses a lane that is not there, and a kind it does not know", async () => {
    expect(
      (await run("track input bass midi")).lines.refuse.join(" "),
    ).toContain('no track "bass"');
    expect(
      (await run("track input keys guitar")).lines.refuse.join(" "),
    ).toContain("usage");
  });
});
