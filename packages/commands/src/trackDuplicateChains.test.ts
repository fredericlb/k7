// `track duplicate` in a chain project — the new lane is a tracks/ file and a `start: true` chain of
// copies under fresh ids; a chain fed by the lane alone is copied too, a shared one stays shared.
// See packages/song/docs/chainFiles.md, "Writing to a chain project".

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChainProject } from "@studio/song/chainProject";
import { loadGraph } from "@studio/song/graph";
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
const chain = (name: string) =>
  parseYaml(read(`chains/${name}.yaml`), { version: "1.2" });

const ORIGINAL_IDS = [
  "in-1",
  "lane-gtr",
  "amp-1",
  "syn-1",
  "drv-1",
  "verb-1",
  "bus-1",
  "lane-bass",
  "syn-2",
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-chains-"));
  dir = join(root, "song.st0");
  mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "amp", "module.yaml"),
    "plugin: { type: internal, name: Amp }\n",
    "utf8",
  );
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
  put(
    "tracks/gtr.yaml",
    'extends: "@meta/track"\ncolor: "#ff0000"\nevents:\n  - { ref: riff, start: "1:1:1" }\n',
  );
  put("tracks/bass.yaml", 'extends: "@meta/track"\nevents: []\n');
  const amp = '"@workspace/audio/amp"';
  put(
    "chains/gtr.yaml",
    [
      "start: true",
      "steps:",
      `  - { id: in-1, extends: ${amp} }`,
      "  - { id: lane-gtr, track: gtr, bypass: true }",
      `  - { id: amp-1, extends: ${amp}, bypass: true }`,
      `  - { id: syn-1, extends: ${amp}, vstpreset: shared.vstpreset }`,
      `  - { id: drv-1, extends: ${amp}, vstpreset: gtr-drive.vstpreset }`,
      "  - to: [ { chain: MIX, level: 1 }, { chain: verb, level: 0.3 }, { chain: bus, level: 0.5 } ]",
      "",
    ].join("\n"),
  );
  put(
    "chains/verb.yaml",
    `steps:\n  - { id: verb-1, extends: ${amp} }\n  - to: [ { chain: MIX } ]\n`,
  );
  put(
    "chains/bus.yaml",
    `steps:\n  - { id: bus-1, extends: ${amp} }\n  - to: [ { chain: MIX } ]\n`,
  );
  put(
    "chains/bass.yaml",
    `start: true\nsteps:\n  - { id: lane-bass, track: bass }\n  - { id: syn-2, extends: ${amp}, vstpreset: shared.vstpreset }\n  - to: [ { chain: bus } ]\n`,
  );
  put("vstpresets/amp-1.vstpreset", "AMP-STATE");
  put("vstpresets/gtr-drive.vstpreset", "DRIVE-STATE");
  put("vstpresets/shared.vstpreset", "SHARED-STATE");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("track duplicate, in a chain project", () => {
  it("copies the lane chain's subchains under fresh ids, a link to one never read as a top-level chain", async () => {
    put(
      "chains/bass.yaml",
      [
        "start: true",
        "steps:",
        "  - { id: lane-bass, track: bass }",
        "  - to: [ { chain: verb, level: 0.5 }, { chain: bus, level: 1 } ]",
        "subchains:",
        "  - id: verb",
        "    steps:",
        '      - { id: sub-1, extends: "@workspace/audio/amp" }',
        "      - to: [ { chain: MIX } ]",
        "",
      ].join("\n"),
    );
    const h = await run("track duplicate bass");
    expect(h.lines.refuse).toEqual([]);
    const c = chain("bass-copy");
    expect(c.steps.at(-1).to.map((l: { chain: string }) => l.chain)).toEqual([
      "verb",
      "bus",
    ]);
    expect(c.subchains).toHaveLength(1);
    expect(c.subchains[0].id).toBe("verb");
    expect(c.subchains[0].steps[0].id).not.toBe("sub-1");
    // The top-level `verb` is gtr's alone: duplicating bass copies none of it.
    expect(readdirSync(join(dir, "chains")).sort()).toEqual([
      "bass-copy.yaml",
      "bass.yaml",
      "bus.yaml",
      "gtr.yaml",
      "verb.yaml",
    ]);
  });

  it("writes the lane's tracks/ file with its events and colour, and no graph.yaml nor nodes/", async () => {
    const h = await run("track duplicate gtr");
    expect(h.lines.refuse).toEqual([]);
    expect(read("tracks/gtr-copy.yaml")).toContain("ref: riff");
    expect(read("tracks/gtr-copy.yaml")).toContain("#ff0000");
    expect(existsSync(join(dir, "graph.yaml"))).toBe(false);
    expect(existsSync(join(dir, "nodes"))).toBe(false);
    expect(h.lines.log[0]).toMatch(
      /^\+ track gtr-copy \(tracks\/gtr-copy\.yaml, chains\/gtr-copy\.yaml/,
    );
  });

  it("copies the chain from the lane on, every item under a fresh id, bypass kept but not the lane's mute", async () => {
    await run("track duplicate gtr");
    const c = chain("gtr-copy");
    expect(c.start).toBe(true);
    const items = c.steps.slice(0, -1);
    expect(items[0]).toEqual({ id: expect.any(String), track: "gtr-copy" });
    expect(items.map((i: { extends?: string }) => i.extends).slice(1)).toEqual(
      Array(3).fill("@workspace/audio/amp"),
    );
    expect(items[1].bypass).toBe(true);
    const ids = items.map((i: { id: string }) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(ORIGINAL_IDS).not.toContain(id);
  });

  it("copies an own preset to the copy's id and keeps a shared one shared", async () => {
    await run("track duplicate gtr");
    const [, amp, syn, drv] = chain("gtr-copy").steps;
    expect(read(`vstpresets/${amp.id}.vstpreset`)).toBe("AMP-STATE");
    expect(amp.vstpreset).toBeUndefined();
    expect(read(`vstpresets/${drv.id}.vstpreset`)).toBe("DRIVE-STATE");
    expect(drv.vstpreset).toBeUndefined();
    expect(syn.vstpreset).toBe("shared.vstpreset");
    expect(existsSync(join(dir, "vstpresets", `${syn.id}.vstpreset`))).toBe(
      false,
    );
  });

  it("copies a chain fed by the lane alone, keeps a shared bus, and keeps every level", async () => {
    await run("track duplicate gtr");
    const links = chain("gtr-copy").steps.at(-1).to;
    expect(links).toEqual([
      { chain: "MIX", level: 1 },
      { chain: "gtr-copy_verb_1", level: 0.3 },
      { chain: "bus", level: 0.5 },
    ]);
    const verb = chain("gtr-copy_verb_1");
    expect(verb.start).toBeUndefined();
    expect(verb.steps[0].id).not.toBe("verb-1");
    expect(read("chains/verb.yaml")).toContain("verb-1");
  });

  it("leaves a project that reads clean, with the copy in the graph", async () => {
    await run("track duplicate gtr");
    expect(readChainProject(dir).issues).toEqual([]);
    const g = loadGraph(dir);
    expect(Object.keys(g.tracks)).toEqual(
      expect.arrayContaining(["gtr", "gtr-copy"]),
    );
  });

  it("leaves the copy's events empty with the empty form", async () => {
    await run("track duplicate empty gtr");
    expect(read("tracks/gtr-copy.yaml")).toContain("events: []");
    expect(chain("gtr-copy").steps[0].track).toBe("gtr-copy");
  });

  it("takes the next free name when the first is a chain already", async () => {
    put(
      "chains/gtr-copy.yaml",
      `steps:\n  - { id: x-1, extends: "@workspace/audio/amp" }\n`,
    );
    await run("track duplicate gtr");
    expect(existsSync(join(dir, "tracks", "gtr-copy-2.yaml"))).toBe(true);
    expect(chain("gtr-copy-2").steps[0].track).toBe("gtr-copy-2");
  });

  it("refuses a lane with no tracks/ file", async () => {
    const h = await run("track duplicate nope");
    expect(h.lines.refuse[0]).toContain("tracks/nope.yaml does not exist");
  });
});
