// `node preset` on a RACK: a kit kept as a preset and loaded onto another kit node, refused when a
// pad plays a sound only one project has. Through the dispatcher and asserting the files, for the
// reason bypass.test.ts gives. See packages/song/docs/userPresets.md.

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
import { librariesFixture } from "@studio/song/testSupport";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parse } from "yaml";
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
const node = (name: string) =>
  parse(readFileSync(join(dir, "nodes", `${name}.yaml`), "utf8"));
const kept = (name: string) =>
  join(root, "_presets", "workspace", "instruments", "drums", `${name}.yaml`);

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  root = mkdtempSync(join(tmpdir(), "td-preset-rack-"));
  const lib = librariesFixture(root, "st0");
  mkdirSync(join(lib, "samples", "kicks"), { recursive: true });
  writeFileSync(join(lib, "samples", "kicks", "808.wav"), "");
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  mkdirSync(join(root, "_modules", "instruments", "drums"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "_modules", "instruments", "drums", "module.yaml"),
    "type: rack\n",
  );
  writeFileSync(
    join(dir, "nodes", "kit.yaml"),
    'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n    BD: { note: 36, sample: "@st0/kicks/808.wav" }\n    SN: { note: 38 }\n',
  );
  writeFileSync(
    join(dir, "nodes", "other.yaml"),
    'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n    HH: { note: 42 }\n',
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  kit: [ OUT ]\n  other: [ OUT ]\n",
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("keeps a kit of library samples as a preset, one pad per line", async () => {
  await runCommand("node preset save kit house", host(), "cli");
  const text = readFileSync(kept("house"), "utf8");
  expect(text).toContain('  BD: { note: 36, sample: "@st0/kicks/808.wav" }\n');
  expect(parse(text)).toEqual({
    rack: {
      BD: { note: 36, sample: "@st0/kicks/808.wav" },
      SN: { note: 38 },
    },
  });
});

it("loads a kit onto another node IN PLACE of its own, and reloads", async () => {
  await runCommand("node preset save kit house", host(), "cli");
  await runCommand("node preset apply other workspace house", host(), "cli");
  expect(node("other").rack.symbols).toEqual({
    BD: { note: 36, sample: "@st0/kicks/808.wav" },
    SN: { note: 38 },
  });
  expect(reloaded).toBe(1);
});

it("refuses a kit with a pad playing a project's own sample", async () => {
  writeFileSync(
    join(dir, "nodes", "kit.yaml"),
    'extends: "@workspace/instruments/drums"\ntype: rack\nrack:\n  symbols:\n    BD: { note: 36, sample: "@project/kick.wav" }\n',
  );
  await runCommand("node preset save kit local", host(), "cli");
  expect(logs.at(-1)).toMatch(/@project\/kick\.wav.*only this project has/);
  expect(existsSync(kept("local"))).toBe(false);
});

it("refuses to load a kit onto a node that is no rack, writing nothing", async () => {
  mkdirSync(join(root, "_modules", "audio", "comp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "comp", "module.yaml"),
    "plugin: { type: internal, name: compressor }\n",
  );
  writeFileSync(
    join(dir, "nodes", "comp.yaml"),
    'extends: "@workspace/audio/comp"\n',
  );
  mkdirSync(join(root, "_presets", "workspace", "audio", "comp"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "_presets", "workspace", "audio", "comp", "odd.yaml"),
    "rack:\n  BD: { note: 36 }\n",
  );
  await runCommand("node preset apply comp workspace odd", host(), "cli");
  expect(logs.at(-1)).toMatch(/holds a kit and 'comp' is not a rack/);
  expect(readFileSync(join(dir, "nodes", "comp.yaml"), "utf8")).toBe(
    'extends: "@workspace/audio/comp"\n',
  );
});
