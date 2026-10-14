// `node param <node> ir <file>` — a cabinet IR picked from the libraries' `irs/`, through the same verb an
// amp `model` is, and checked against the same list the panel's picker offers (packages/song/docs/libraryFiles.md).

import {
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
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;
const node = () => readFileSync(join(dir, "nodes", "amp.yaml"), "utf8");

beforeEach(() => {
  logs.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-ir-"));
  const lib = librariesFixture(root, "k7-core");
  mkdirSync(join(lib, "irs", "deluxe"), { recursive: true });
  writeFileSync(join(lib, "irs", "deluxe", "big.wav"), "");
  mkdirSync(join(lib, "models", "proteus"), { recursive: true });
  writeFileSync(join(lib, "models", "proteus", "ts9.json"), "{}");
  dir = join(root, "song.k7");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "amp", "module.yaml"),
    "plugin: { type: internal, name: Neural Amp Modeler }\n",
  );
  writeFileSync(
    join(dir, "nodes", "amp.yaml"),
    'extends: "@workspace/audio/amp"\n',
  );
  writeFileSync(join(dir, "graph.yaml"), "modules:\n  amp: [ OUT ]\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("writes a library IR by the name it was picked with", async () => {
  await runCommand(
    'node param "amp" "ir" "@k7-core/deluxe/big.wav"',
    host(),
    "cli",
  );
  expect(node()).toContain('ir: "@k7-core/deluxe/big.wav"');
});

it("refuses a file no library holds, and writes nothing", async () => {
  const before = node();
  await runCommand(
    'node param "amp" "ir" "@k7-core/deluxe/small.wav"',
    host(),
    "cli",
  );
  expect(logs.join(" ")).toContain("no '@k7-core/deluxe/small.wav'");
  expect(node()).toBe(before);
});

it("clears it with `none`", async () => {
  await runCommand(
    'node param "amp" "ir" "@k7-core/deluxe/big.wav"',
    host(),
    "cli",
  );
  await runCommand('node param "amp" "ir" none', host(), "cli");
  expect(node()).not.toContain("big.wav");
});

it("takes an amp `model` from a library's models/ by its @ name, and refuses one no library holds", async () => {
  await runCommand(
    'node param "amp" "model" "@k7-core/proteus/ts9.json"',
    host(),
    "cli",
  );
  expect(node()).toContain('model: "@k7-core/proteus/ts9.json"');
  logs.length = 0;
  const before = node();
  await runCommand(
    'node param "amp" "model" "@k7-core/proteus/rat.json"',
    host(),
    "cli",
  );
  expect(logs.join(" ")).toContain(
    "no '@k7-core/proteus/rat.json' in the libraries' models/",
  );
  expect(node()).toBe(before);
});
