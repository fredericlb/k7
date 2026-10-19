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
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
const doc = (rel: string, value: Record<string, unknown>): void =>
  writeDoc(join(dir, rel), value);
const read = (rel: string): string => readFileSync(join(dir, rel), "utf8");
// biome-ignore lint/suspicious/noExplicitAny: a chain file's data, read loosely by the assertions.
const chain = (name: string): any => wsData(join(dir, `chains/${name}.k7x`));

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

const AMP = "@workspace/audio/amp";
/** gtr's chain, its drive naming `drive` as its preset. */
const gtrChain = (drive = "gtr-drive.vstpreset") =>
  doc("chains/gtr.k7x", {
    start: true,
    steps: [
      { id: "in-1", extends: AMP },
      { id: "lane-gtr", track: "gtr", bypass: true },
      { id: "amp-1", extends: AMP, bypass: true },
      { id: "syn-1", extends: AMP, vstpreset: "shared.vstpreset" },
      { id: "drv-1", extends: AMP, vstpreset: drive },
      {
        to: [
          { chain: "MIX", level: 1 },
          { chain: "verb", level: 0.3 },
          { chain: "bus", level: 0.5 },
        ],
      },
    ],
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-chains-"));
  dir = join(root, "song.k7");
  writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Amp" },
  });
  doc("project.k7x", { project: { name: "t", tempo: 120 } });
  doc("tracks/gtr.k7x", {
    extends: "@meta/track",
    color: "#ff0000",
    events: [{ ref: "riff", start: "1:1:1" }],
  });
  doc("tracks/bass.k7x", { extends: "@meta/track", events: [] });
  gtrChain();
  doc("chains/verb.k7x", {
    steps: [{ id: "verb-1", extends: AMP }, { to: [{ chain: "MIX" }] }],
  });
  doc("chains/bus.k7x", {
    steps: [{ id: "bus-1", extends: AMP }, { to: [{ chain: "MIX" }] }],
  });
  doc("chains/bass.k7x", {
    start: true,
    steps: [
      { id: "lane-bass", track: "bass" },
      { id: "syn-2", extends: AMP, vstpreset: "shared.vstpreset" },
      { to: [{ chain: "bus" }] },
    ],
  });
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
    doc("chains/bass.k7x", {
      start: true,
      steps: [
        { id: "lane-bass", track: "bass" },
        {
          to: [
            { chain: "verb", level: 0.5 },
            { chain: "bus", level: 1 },
          ],
        },
      ],
      subchains: [
        {
          id: "verb",
          steps: [{ id: "sub-1", extends: AMP }, { to: [{ chain: "MIX" }] }],
        },
      ],
    });
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
      "bass-copy.k7x",
      "bass.k7x",
      "bus.k7x",
      "gtr.k7x",
      "verb.k7x",
    ]);
  });

  it("writes the lane's tracks/ file with its events and colour, and no graph.k7x nor nodes/", async () => {
    const h = await run("track duplicate gtr");
    expect(h.lines.refuse).toEqual([]);
    const copy = wsData(join(dir, "tracks/gtr-copy.k7x"));
    expect(copy.events).toEqual([expect.objectContaining({ ref: "riff" })]);
    expect(copy.color).toBe("#ff0000");
    expect(existsSync(join(dir, "graph.k7x"))).toBe(false);
    expect(existsSync(join(dir, "nodes"))).toBe(false);
    expect(h.lines.log[0]).toMatch(
      /^\+ track gtr-copy \(tracks\/gtr-copy\.k7x, chains\/gtr-copy\.k7x/,
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

  it("copies no preset a chain file names outside the project's presets folder", async () => {
    writeFileSync(join(root, "secret.vstpreset"), "SECRET", "utf8");
    gtrChain("../../secret.vstpreset");
    const h = await run("track duplicate gtr");
    expect(h.lines.refuse).toEqual([]);
    const drv = chain("gtr-copy").steps[4];
    expect(existsSync(join(dir, "vstpresets", `${drv.id}.vstpreset`))).toBe(
      false,
    );
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
    expect(chain("verb").steps[0].id).toBe("verb-1");
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
    expect(wsData(join(dir, "tracks/gtr-copy.k7x")).events).toEqual([]);
    expect(chain("gtr-copy").steps[0].track).toBe("gtr-copy");
  });

  it("takes the next free name when the first is a chain already", async () => {
    doc("chains/gtr-copy.k7x", { steps: [{ id: "x-1", extends: AMP }] });
    await run("track duplicate gtr");
    expect(existsSync(join(dir, "tracks", "gtr-copy-2.k7x"))).toBe(true);
    expect(chain("gtr-copy-2").steps[0].track).toBe("gtr-copy-2");
  });

  it("refuses a lane with no tracks/ file", async () => {
    const h = await run("track duplicate nope");
    expect(h.lines.refuse[0]).toContain("tracks/nope.k7x does not exist");
  });
});
