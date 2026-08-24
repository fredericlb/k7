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
import { ModuleSchema } from "@studio/song-schema/yaml/moduleSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import {
  insertChainStepAfter,
  replaceChainStep,
  writeModule,
} from "./testSupport";

// A module needn't extend anything, so the schema, the ref-check and the build loop must all allow it.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.st0",
);

// Found by the PREFIX "synth", since the song names a NODE there, and a miss throws loudly.

describe("bare (extends-less) modules", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-bare-"));
    cpSync(SONG, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes extends optional, and has no `name` field at all", () => {
    // A bare module has to VALIDATE, and `name` must not exist since the FOLDER names it.
    expect(ModuleSchema.safeParse({}).success).toBe(true);
    expect(
      ModuleSchema.safeParse({ extends: "instruments/fourosc" }).success,
    ).toBe(true);
    expect(ModuleSchema.safeParse({ name: "kit" }).success).toBe(false);
  });

  it("compiles a chain that uses a bare (extends-less) module — routing only, no plugin", () => {
    createModuleFile(dir, "instruments", "bare"); // just a name, no extends
    insertChainStepAfter(dir, "lead", { module: "bare" });
    const doc = compileNodeProject(dir); // must not throw: an empty base is not a lookup
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody).toBeTruthy();
    // The bare step contributes no processor; the real one is untouched.
    expect(melody!.plugins.some((p) => p.id.endsWith(":bare"))).toBe(false);
    expect(melody!.plugins.some((p) => p.type === "4osc")).toBe(true);
  });

  it("compiles a self-contained rack module (inline rack, no extends) to a sampler", () => {
    // Called `drumkit` and not `kit`, since the fixture's `kit` is a LANE in the same name space.
    writeModule(dir, "instruments", "drumkit", {
      type: "rack",
      rack: { symbols: { BD: { note: 36, clip: "kick.wav" } } },
    });
    replaceChainStep(dir, "lead", { module: "drumkit" });
    const doc = compileNodeProject(dir);
    const melody = doc.tracks.find((t) => t.id === "melody");
    const kit = melody!.plugins.find((p) => p.id.endsWith(":drumkit"));
    expect(kit?.type).toBe("sampler");
    expect(kit?.rack?.length).toBe(1); // the BD sound, from the module's own rack
  });
});
