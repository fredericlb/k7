// `track hide` / `track unhide` — `hidden: true` on the lane's chain sets it aside whole: no node of it
// compiled or drawn, its files untouched by later edits, its solo dropped, and back in one line.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editChainGraph } from "@studio/song/chainGraphEdit";
import {
  readChainProject,
  readLayout,
  toSegments,
} from "@studio/song/chainProject";
import { setModuleEnabled } from "@studio/song-schema/yaml/graphFile";
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
const segments = () =>
  toSegments(readChainProject(dir), readLayout(dir)).graph.modules ?? {};
const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

const AMP = '"@st0/audio/amp"';
// The bus is fed by gtr alone: once gtr is hidden, nothing the graph shows reaches it.
const BUS = `steps:\n  - { id: bus-1, extends: ${AMP} }\n  - { id: bus-2, extends: ${AMP} }\n  - to: [ { chain: MIX } ]\n`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "track-hide-"));
  dir = join(root, "song.st0");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\nsoloed: [gtr]\n");
  put("tracks/gtr.yaml", 'extends: "@meta/track"\nevents: []\n');
  put("tracks/bass.yaml", 'extends: "@meta/track"\nevents: []\n');
  put(
    "chains/gtr.yaml",
    `start: true\nsteps:\n  - { id: lane-gtr, track: gtr }\n  - { id: amp-1, extends: ${AMP} }\n  - to: [ { chain: bus } ]\n`,
  );
  put("chains/bus.yaml", BUS);
  put(
    "chains/bass.yaml",
    `start: true\nsteps:\n  - { id: lane-bass, track: bass }\n  - { id: amp-2, extends: ${AMP} }\n  - to: [ { chain: MIX } ]\n`,
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("track hide", () => {
  it("marks the lane's chain hidden, so neither the lane nor its nodes compile", async () => {
    const h = await run("track hide gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(parse(read("chains/gtr.yaml")).hidden).toBe(true);
    const cp = readChainProject(dir);
    expect(cp.nodes.gtr).toBeUndefined();
    expect(cp.nodes["amp-1"]).toBeUndefined();
    expect(Object.keys(segments())).toEqual(["bass", "amp-2"]);
  });

  it("drops the lane from `soloed`, where it would silence every other lane", async () => {
    await run("track hide gtr");
    expect(parse(read("project.yaml")).soloed).toBeUndefined();
  });

  it("leaves the hidden chain and what only it fed alone through a later graph edit", async () => {
    await run("track hide gtr");
    const gtr = read("chains/gtr.yaml");
    editChainGraph(dir, (t) => setModuleEnabled(t, "amp-2", false));
    expect(read("chains/gtr.yaml")).toBe(gtr);
    expect(read("chains/bus.yaml")).toBe(BUS);
  });

  it("refuses a lane already hidden, and `track unhide` brings it back", async () => {
    await run("track hide gtr");
    expect((await run("track hide gtr")).lines.refuse.join(" ")).toMatch(
      /already hidden/,
    );
    const h = await run("track unhide gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(parse(read("chains/gtr.yaml")).hidden).toBeUndefined();
    expect(segments().gtr).toEqual(["amp-1"]);
    expect(segments()["amp-1"]).toEqual(["bus-1"]);
  });

  it("refuses a project kept as graph.yaml", async () => {
    rmSync(join(dir, "chains"), { recursive: true });
    put("graph.yaml", "modules: {}\n");
    const h = await run("track hide gtr");
    expect(h.lines.refuse.join(" ")).toMatch(/only a chain project/);
  });
});
