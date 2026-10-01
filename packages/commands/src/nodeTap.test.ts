// `node tap note|sample|add|remove` — a rack NODE's kit, written into the node and never the module,
// its samples checked against the libraries' `samples/` (packages/song/docs/racks.md).

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
import { parse } from "yaml";
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
const moduleFile = () =>
  join(root, "_modules", "instruments", "drums", "module.yaml");
const kit = () =>
  parse(readFileSync(join(dir, "nodes", "kit.yaml"), "utf8"), {
    version: "1.2",
  }) as {
    rack?: { symbols?: Record<string, { note: number; sample?: string }> };
    alternatives?: { rack?: { symbols?: Record<string, { note: number }> } }[];
  };

beforeEach(() => {
  logs.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-tap-"));
  const lib = librariesFixture(root, "st0");
  mkdirSync(join(lib, "samples", "kicks"), { recursive: true });
  writeFileSync(join(lib, "samples", "kicks", "808 deep.wav"), "");
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  mkdirSync(join(root, "_modules", "instruments", "drums"), {
    recursive: true,
  });
  // The generic sampler: a rack with no sounds of its own.
  writeFileSync(moduleFile(), "type: rack\n");
  writeFileSync(
    join(dir, "nodes", "kit.yaml"),
    'extends: "@workspace/instruments/drums"\ntype: rack\n',
  );
  writeFileSync(join(dir, "graph.yaml"), "modules:\n  kit: [ OUT ]\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("adds a tap to the NODE on the first free note, and leaves the module alone", async () => {
  await runCommand("node tap add kit", host(), "cli");
  await runCommand("node tap add kit SN", host(), "cli");
  expect(kit().rack?.symbols).toEqual({ T1: { note: 36 }, SN: { note: 37 } });
  expect(readFileSync(moduleFile(), "utf8")).toBe("type: rack\n");
});

it("sets a tap's sample by its library name — spaces and all — and its note", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand(
    'node tap sample kit BD "@st0/kicks/808 deep.wav"',
    host(),
    "cli",
  );
  await runCommand("node tap note kit BD 35", host(), "cli");
  expect(kit().rack?.symbols?.BD).toEqual({
    note: 35,
    sample: "@st0/kicks/808 deep.wav",
  });
});

it("refuses a sample no library holds, and writes nothing", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  const before = kit();
  await runCommand(
    'node tap sample kit BD "@st0/kicks/missing.wav"',
    host(),
    "cli",
  );
  expect(logs.join(" ")).toContain("no '@st0/kicks/missing.wav'");
  expect(kit()).toEqual(before);
});

it("removes a tap, and refuses one the node does not have", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand("node tap remove kit BD", host(), "cli");
  expect(kit().rack?.symbols ?? {}).toEqual({});
  await runCommand("node tap remove kit BD", host(), "cli");
  expect(logs.join(" ")).toContain("has no tap 'BD'");
});

it("writes into the ALTERNATIVE that is on, as a knob does", async () => {
  writeFileSync(
    join(dir, "nodes", "kit.yaml"),
    'extends: "@workspace/instruments/drums"\ntype: rack\nalternatives:\n  - name: b\nalternative: b\n',
  );
  await runCommand("node tap add kit BD", host(), "cli");
  expect(kit().rack).toBeUndefined();
  expect(kit().alternatives?.[0].rack?.symbols).toEqual({ BD: { note: 36 } });
});

it("refuses a node that is not a rack", async () => {
  mkdirSync(join(root, "_modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "amp", "module.yaml"),
    "plugin: { type: internal, name: Chorus }\n",
  );
  writeFileSync(
    join(dir, "nodes", "amp.yaml"),
    'extends: "@workspace/audio/amp"\n',
  );
  await runCommand("node tap add amp", host(), "cli");
  expect(logs.join(" ")).toContain("is not a rack");
});

it("takes a sample from the PROJECT's own samples/, as @project/…", async () => {
  mkdirSync(join(dir, "samples"), { recursive: true });
  writeFileSync(join(dir, "samples", "clap.wav"), "");
  await runCommand("node tap add kit CP", host(), "cli");
  await runCommand('node tap sample kit CP "@project/clap.wav"', host(), "cli");
  expect(kit().rack?.symbols?.CP).toEqual({
    note: 36,
    sample: "@project/clap.wav",
  });
});

it("inserts a tap on the nearest free note beside another, and never renumbers the kit", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand("node tap add kit SN", host(), "cli");
  await runCommand("node tap insert kit after BD", host(), "cli");
  await runCommand("node tap insert kit before BD CR", host(), "cli");
  expect(kit().rack?.symbols).toEqual({
    BD: { note: 36 },
    SN: { note: 37 },
    T3: { note: 38 },
    CR: { note: 35 },
  });
  await runCommand("node tap insert kit beside BD", host(), "cli");
  expect(logs.join(" ")).toContain("usage: node tap insert");
});

it("renames a tap in place, its note and sample kept, and refuses a taken name", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand("node tap add kit SN", host(), "cli");
  await runCommand(
    'node tap sample kit BD "@st0/kicks/808 deep.wav"',
    host(),
    "cli",
  );
  await runCommand("node tap rename kit BD KICK", host(), "cli");
  expect(Object.keys(kit().rack?.symbols ?? {})).toEqual(["KICK", "SN"]);
  expect(kit().rack?.symbols?.KICK).toEqual({
    note: 36,
    sample: "@st0/kicks/808 deep.wav",
  });
  await runCommand("node tap rename kit KICK SN", host(), "cli");
  expect(logs.join(" ")).toContain("already has a tap 'SN'");
  await runCommand('node tap rename kit SN "two words"', host(), "cli");
  expect(logs.join(" ")).toContain("is not a tap name");
});
