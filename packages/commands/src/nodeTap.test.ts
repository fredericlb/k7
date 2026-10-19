// `node tap note|sample|add|remove` — a rack NODE's kit, written into the node and never the module,
// its samples checked against the libraries' `samples/` (packages/song/docs/racks.md).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;
const DRUMS = "@workspace/instruments/drums";
const moduleFile = () =>
  join(root, "_modules", "instruments", "drums", "module.k7x");
const kitFile = () => join(dir, "nodes", "kit.k7x");
const kit = () =>
  wsData(kitFile()) as {
    rack?: { symbols?: Record<string, { note: number; sample?: string }> };
    alternatives?: { rack?: { symbols?: Record<string, { note: number }> } }[];
  };

beforeEach(() => {
  logs.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-tap-"));
  const lib = librariesFixture(root, "k7-core");
  mkdirSync(join(lib, "samples", "kicks"), { recursive: true });
  writeFileSync(join(lib, "samples", "kicks", "808 deep.wav"), "");
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "song" } });
  // The generic sampler: a rack with no sounds of its own.
  writeDoc(moduleFile(), { type: "rack" });
  writeNode(dir, "kit", { extends: DRUMS, type: "rack" });
  writeDoc(join(dir, "graph.k7x"), { modules: { kit: ["OUT"] } });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.STUDIO_HOME;
});

it("adds a tap to the NODE on the first free note, and leaves the module alone", async () => {
  await runCommand("node tap add kit", host(), "cli");
  await runCommand("node tap add kit SN", host(), "cli");
  expect(kit().rack?.symbols).toEqual({ T1: { note: 36 }, SN: { note: 37 } });
  expect(wsData(moduleFile())).toEqual({ type: "rack" });
});

it("adds a tap on a GIVEN note — an empty pad of the octave grid — and refuses a taken one", async () => {
  await runCommand("node tap at kit 40", host(), "cli");
  await runCommand("node tap at kit 42 HH", host(), "cli");
  expect(kit().rack?.symbols).toEqual({ T1: { note: 40 }, HH: { note: 42 } });
  await runCommand("node tap at kit 42", host(), "cli");
  expect(logs.join(" ")).toContain("already has a tap on note 42");
});

it("sets a tap's sample by its library name — spaces and all — and its note", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand(
    'node tap sample kit BD "@k7-core/kicks/808 deep.wav"',
    host(),
    "cli",
  );
  await runCommand("node tap note kit BD 35", host(), "cli");
  expect(kit().rack?.symbols?.BD).toEqual({
    note: 35,
    sample: "@k7-core/kicks/808 deep.wav",
  });
});

it("refuses a sample no library holds, and writes nothing", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  const before = kit();
  await runCommand(
    'node tap sample kit BD "@k7-core/kicks/missing.wav"',
    host(),
    "cli",
  );
  expect(logs.join(" ")).toContain("no '@k7-core/kicks/missing.wav'");
  expect(kit()).toEqual(before);
});

it("removes a tap, and refuses one the node does not have", async () => {
  await runCommand("node tap add kit BD", host(), "cli");
  await runCommand("node tap remove kit BD", host(), "cli");
  expect(kit().rack?.symbols ?? {}).toEqual({});
  await runCommand("node tap remove kit BD", host(), "cli");
  expect(logs.join(" ")).toContain("has no tap 'BD'");
});

it("refuses to remove an inherited tap, leaving a node with no rack of its own untouched", async () => {
  writeDoc(moduleFile(), {
    type: "rack",
    rack: { symbols: { BD: { note: 36 } } },
  });
  const before = wsText(kitFile());
  await runCommand("node tap remove kit BD", host(), "cli");
  expect(logs.join(" ")).toContain("comes from kit's module");
  expect(wsText(kitFile())).toBe(before);
});

it("writes into the ALTERNATIVE that is on, as a knob does", async () => {
  writeNode(dir, "kit", {
    extends: DRUMS,
    type: "rack",
    alternatives: [{ name: "b" }],
    alternative: "b",
  });
  await runCommand("node tap add kit BD", host(), "cli");
  expect(kit().rack).toBeUndefined();
  expect(kit().alternatives?.[0].rack?.symbols).toEqual({ BD: { note: 36 } });
});

it("refuses a node that is not a rack", async () => {
  writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeNode(dir, "amp", { extends: "@workspace/audio/amp" });
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
    'node tap sample kit BD "@k7-core/kicks/808 deep.wav"',
    host(),
    "cli",
  );
  await runCommand("node tap rename kit BD KICK", host(), "cli");
  expect(Object.keys(kit().rack?.symbols ?? {})).toEqual(["KICK", "SN"]);
  expect(kit().rack?.symbols?.KICK).toEqual({
    note: 36,
    sample: "@k7-core/kicks/808 deep.wav",
  });
  await runCommand("node tap rename kit KICK SN", host(), "cli");
  expect(logs.join(" ")).toContain("already has a tap 'SN'");
  await runCommand('node tap rename kit SN "two words"', host(), "cli");
  expect(logs.join(" ")).toContain("is not a tap name");
});

it("mutes a tap and brings it back — a toggle without on/off, and `mute:` written only while on", async () => {
  await runCommand("node tap at kit 42 HH", host(), "cli");
  await runCommand("node tap mute kit HH", host(), "cli");
  expect(kit().rack?.symbols?.HH).toEqual({ note: 42, mute: true });
  await runCommand("node tap mute kit HH", host(), "cli");
  expect(kit().rack?.symbols?.HH).toEqual({ note: 42 });
  await runCommand("node tap mute kit HH on", host(), "cli");
  await runCommand("node tap mute kit HH on", host(), "cli");
  expect(kit().rack?.symbols?.HH).toEqual({ note: 42, mute: true });
});
