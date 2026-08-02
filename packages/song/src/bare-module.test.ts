import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModuleFile } from "@studio/song/loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import {
  insertChainStepAfter,
  replaceChainStep,
  writeModule,
} from "./testSupport";
import { ModuleSchema } from "./yaml/moduleSchema";

// A module needn't extend anything — it can carry its rack inline, or stand as a bare
// routing node. These check the three enforcement points that used to require a base: the
// generated #tdModule schema, the compiler's ref-check + build loop.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "apps",
  "capot",
  "songs",
  "synth-demo",
);

// The fixture's instrument step is found by the PREFIX "synth", not matched literally: the
// song names an INSTANCE there ({module: synth:lead}), and these tests only care that it's
// the synth module's step, whichever of its files the demo happens to use. testSupport
// throws when no such step exists, so an edit aimed at a step that moved fails loudly
// instead of leaving a test that proves nothing.

describe("bare (extends-less) modules", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-bare-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes extends optional, and has no `name` field at all", () => {
    // The schema's half of it: a bare module has to VALIDATE before the compiler can be
    // asked to build one. And `name` must not exist — the FOLDER names the module, so a
    // file carrying one would give two answers with no rule for which wins.
    expect(ModuleSchema.safeParse({}).success).toBe(true);
    expect(
      ModuleSchema.safeParse({ extends: "instruments/fourosc" }).success,
    ).toBe(true);
    expect(ModuleSchema.safeParse({ name: "kit" }).success).toBe(false);
  });

  it("compiles a chain that uses a bare (extends-less) module — routing only, no plugin", () => {
    createModuleFile(dir, "instruments", "bare"); // just a name, no extends
    insertChainStepAfter(dir, "synth", { module: "bare" });
    const doc = compileNodeProject(dir); // used to throw: base '' not found
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody).toBeTruthy();
    // The bare step contributes no processor; the real one is untouched.
    expect(melody!.plugins.some((p) => p.id.endsWith(":bare"))).toBe(false);
    expect(melody!.plugins.some((p) => p.type === "4osc")).toBe(true);
  });

  it("compiles a self-contained rack module (inline rack, no extends) to a sampler", () => {
    // The module is its own folder; the file is the generic one and the FOLDER names it.
    writeModule(dir, "instruments", "kit", {
      type: "rack",
      rack: { symbols: { BD: { note: 36, clip: "kick.wav" } } },
    });
    replaceChainStep(dir, "synth", { module: "kit" });
    const doc = compileNodeProject(dir);
    const melody = doc.tracks.find((t) => t.id === "melody");
    const kit = melody!.plugins.find((p) => p.id.endsWith(":kit"));
    expect(kit?.type).toBe("sampler");
    expect(kit?.rack?.length).toBe(1); // the BD sound, from the module's own rack
  });
});
