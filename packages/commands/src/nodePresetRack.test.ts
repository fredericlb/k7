// `node preset` on a RACK: a kit kept as a preset and loaded onto another kit node, refused when a
// pad plays a sound only one project has. Through the dispatcher and asserting the files, for the
// reason bypass.test.ts gives. See packages/song/docs/userPresets.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  librariesFixture,
  writeDoc,
  writeNode,
} from "@studio/song/testSupport";
import { wsData, wsText } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;
// biome-ignore lint/suspicious/noExplicitAny: the test reads arbitrary depths of the node's data.
const node = (name: string): any => wsData(join(dir, "nodes", `${name}.k7x`));
const kept = (name: string) =>
  join(root, "_presets", "workspace", "instruments", "drums", `${name}.k7x`);
const DRUMS = "@workspace/instruments/drums";
const KIT = {
  BD: { note: 36, sample: "@k7-core/kicks/808.wav" },
  SN: { note: 38 },
};

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  root = mkdtempSync(join(tmpdir(), "td-preset-rack-"));
  const lib = librariesFixture(root, "k7-core");
  mkdirSync(join(lib, "samples", "kicks"), { recursive: true });
  writeFileSync(join(lib, "samples", "kicks", "808.wav"), "");
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "song" } });
  writeDoc(join(root, "_modules", "instruments", "drums", "module.k7x"), {
    type: "rack",
  });
  writeNode(dir, "kit", {
    extends: DRUMS,
    type: "rack",
    rack: { symbols: KIT },
  });
  writeNode(dir, "other", {
    extends: DRUMS,
    type: "rack",
    rack: { symbols: { HH: { note: 42 } } },
  });
  writeDoc(join(dir, "graph.k7x"), {
    modules: { kit: ["OUT"], other: ["OUT"] },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("keeps a kit of library samples as a preset, one pad per line", async () => {
  await runCommand("node preset save kit house", host(), "cli");
  const text = wsText(kept("house"));
  expect(text).toContain('BD: { note: 36, sample: "@k7-core/kicks/808.wav" }');
  expect(text).toContain("SN: { note: 38 }");
  expect(wsData(kept("house"))).toEqual({ rack: KIT });
});

it("loads a kit onto another node IN PLACE of its own, and reloads", async () => {
  await runCommand("node preset save kit house", host(), "cli");
  await runCommand("node preset apply other workspace house", host(), "cli");
  expect(node("other").rack.symbols).toEqual(KIT);
  expect(reloaded).toBe(1);
});

it("loads a kit onto a node that states no pads of its own", async () => {
  writeNode(dir, "other", { extends: DRUMS, type: "rack" });
  await runCommand("node preset save kit house", host(), "cli");
  await runCommand("node preset apply other workspace house", host(), "cli");
  expect(node("other").rack.symbols).toEqual(KIT);
});

it("refuses a kit with a pad playing a project's own sample", async () => {
  writeNode(dir, "kit", {
    extends: DRUMS,
    type: "rack",
    rack: { symbols: { BD: { note: 36, sample: "@project/kick.wav" } } },
  });
  await runCommand("node preset save kit local", host(), "cli");
  expect(logs.at(-1)).toMatch(/@project\/kick\.wav.*only this project has/);
  expect(existsSync(kept("local"))).toBe(false);
});

it("refuses to load a kit onto a node that is no rack, writing nothing", async () => {
  writeDoc(join(root, "_modules", "audio", "comp", "module.k7x"), {
    plugin: { type: "internal", name: "compressor" },
  });
  const comp = writeNode(dir, "comp", { extends: "@workspace/audio/comp" });
  const before = wsText(comp);
  writeDoc(join(root, "_presets", "workspace", "audio", "comp", "odd.k7x"), {
    rack: { BD: { note: 36 } },
  });
  await runCommand("node preset apply comp workspace odd", host(), "cli");
  expect(logs.at(-1)).toMatch(/holds a kit and 'comp' is not a rack/);
  expect(wsText(comp)).toBe(before);
});
