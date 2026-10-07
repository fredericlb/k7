// `track rename` — a lane's name is its file's, prefix included, and every reference follows it:
// the graph (ports kept), project.yaml's order and solo, and the strip `track new` named after it.

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
import { readChainProject } from "@studio/song/chainProject";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
const yaml = (rel: string) => parseYaml(read(rel), { version: "1.2" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-rename-"));
  dir = join(root, "song.st0");
  mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "amp", "module.yaml"),
    "plugin: { type: internal, name: Amp }\n",
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("track rename", () => {
  beforeEach(() => {
    put(
      "project.yaml",
      "project:\n  name: t\n  tempo: 120\ntrackOrder: [ge.lead, bass]\nsoloed: [ge.lead]\n",
    );
    put("nodes/ge.lead.yaml", 'extends: "@meta/track"\nevents: []\n');
    put("nodes/bass.yaml", 'extends: "@meta/track"\nevents: []\n');
    put("nodes/amp_1.yaml", 'extends: "@workspace/audio/amp"\n');
    put(
      "nodes/mix-ge.lead.yaml",
      '# ge.lead\'s channel strip\nextends: "@meta/audio/mixer"\n',
    );
    put(
      "graph.yaml",
      [
        "modules:",
        "  ge.lead#L: [amp_1]",
        "  amp_1: [mix-ge.lead]",
        "  mix-ge.lead: [MIX]",
        "  bass: [MIX]",
        "bypassed: [ge.lead]",
        "",
      ].join("\n"),
    );
  });

  it("moves the file, prefix and all, and rewrites what names the lane", async () => {
    const h = await run("track rename ge.lead vo.lead");
    expect(h.lines.refuse).toEqual([]);
    expect(existsSync(join(dir, "nodes/ge.lead.yaml"))).toBe(false);
    expect(existsSync(join(dir, "nodes/vo.lead.yaml"))).toBe(true);
    const g = yaml("graph.yaml");
    expect(Object.keys(g.modules)).toContain("vo.lead#L");
    expect(g.bypassed).toEqual(["vo.lead"]);
    const p = yaml("project.yaml");
    expect(p.trackOrder).toEqual(["vo.lead", "bass"]);
    expect(p.soloed).toEqual(["vo.lead"]);
  });

  it("takes along the strip named after the lane, and re-labels it", async () => {
    await run("track rename ge.lead vo.lead");
    expect(existsSync(join(dir, "nodes/mix-vo.lead.yaml"))).toBe(true);
    expect(read("nodes/mix-vo.lead.yaml")).toMatch(
      /^# vo\.lead's channel strip/,
    );
    expect(yaml("graph.yaml").modules.amp_1).toEqual(["mix-vo.lead"]);
  });

  it("refuses a name another lane holds", async () => {
    const h = await run("track rename ge.lead bass");
    expect(h.lines.refuse.join(" ")).toMatch(/already/);
    expect(existsSync(join(dir, "nodes/ge.lead.yaml"))).toBe(true);
  });

  it("refuses a track that does not exist", async () => {
    const h = await run("track rename nope other");
    expect(h.lines.refuse.join(" ")).toMatch(/no track/);
  });
});

describe("track rename, in a chain project", () => {
  it("moves tracks/<lane>.yaml and the chain's item follows", async () => {
    put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
    put("tracks/ge.lead.yaml", 'extends: "@meta/track"\nevents: []\n');
    put(
      "chains/ge.lead.yaml",
      'start: true\nsteps:\n  - { id: lane-1, track: ge.lead }\n  - { id: amp-1, extends: "@workspace/audio/amp" }\n  - to: [ { chain: MIX } ]\n',
    );
    const h = await run("track rename ge.lead vo.lead");
    expect(h.lines.refuse).toEqual([]);
    expect(existsSync(join(dir, "tracks/vo.lead.yaml"))).toBe(true);
    expect(existsSync(join(dir, "tracks/ge.lead.yaml"))).toBe(false);
    expect(readChainProject(dir).nodes["vo.lead"]?.track).toBe("vo.lead");
  });
});
