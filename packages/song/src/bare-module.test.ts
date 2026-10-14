import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleSchema } from "@studio/song-schema/yaml/moduleSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import {
  insertChainStepAfter,
  replaceChainStep,
  writeNode,
} from "./testSupport";

// A module needn't extend anything, so the schema, the ref-check and the build loop must all allow it.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.k7");

// Found by the PREFIX "synth", since the song names a NODE there, and a miss throws loudly.

describe("bare (extends-less) modules", () => {
  let ws: string;
  let dir: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-bare-"));
    dir = join(ws, "synth-demo.k7");
    cpSync(SONG, dir, { recursive: true });
    // The Examples workspace's own shared library, beside every demo project.
    cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), { recursive: true });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("makes extends optional, and has no `name` field at all", () => {
    // A bare module has to VALIDATE, and `name` must not exist since the FOLDER names it.
    expect(ModuleSchema.safeParse({}).success).toBe(true);
    expect(
      ModuleSchema.safeParse({ extends: "instruments/fourosc" }).success,
    ).toBe(true);
    expect(ModuleSchema.safeParse({ name: "kit" }).success).toBe(false);
  });

  it("compiles a chain that uses a bare (extends-less) module — routing only, no plugin", () => {
    writeNode(dir, "bare", {}); // just a node, no extends
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
    writeNode(dir, "drumkit", {
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

  it("hands the sampler no MUTED tap, and keeps the others", () => {
    writeNode(dir, "drumkit", {
      type: "rack",
      rack: {
        symbols: {
          BD: { note: 36, clip: "kick.wav" },
          HH: { note: 42, clip: "hat.wav", mute: true },
        },
      },
    });
    replaceChainStep(dir, "lead", { module: "drumkit" });
    const doc = compileNodeProject(dir);
    const melody = doc.tracks.find((t) => t.id === "melody");
    const kit = melody!.plugins.find((p) => p.id.endsWith(":drumkit"));
    expect(kit?.rack?.map((s) => s.symbol)).toEqual(["BD"]);
  });
});
