// A module's ENGINES: sub-folders under `engines/`, each a module of its own, and a node that runs
// as the one picked. Pinned here: an engine is loaded and hidden, the module runs as it with its
// identity kept, params live PER engine, and an alternative may switch engines. See docs/engines.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleStatusOf } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enginesBeside } from "./engines";
import { loadGraph } from "./graph";
import { baseModuleRefs, loadModuleRefs, loadModules } from "./loader";
import { resolveModule } from "./moduleResolve";
import {
  writeLibraries,
  writeLibrary,
  writeNode,
  writeYaml,
} from "./testSupport";
import { loadUiLibrary } from "./uiLibrary";

const COMP = "@st0/audio/dynamics/compressor";
const PANEL = (bind: string) => ({
  cols: 1,
  rows: 1,
  widgets: { k: { type: "knob", col: 0, row: 0, bind, label: bind } },
});

let root: string;
let dir: string;
let lib: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-engines-"));
  writeLibrary(root);
  dir = join(root, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
  lib = writeLibraries(root, {
    "audio/dynamics/compressor": { status: "favorite", engine: "tracktion" },
    "audio/dynamics/compressor/engines/tracktion": {
      plugin: { type: "internal", name: "compressor" },
      params: { Ratio: 0.5 },
    },
    "audio/dynamics/compressor/engines/vari-mu": {
      plugin: { type: "internal", name: "airwindows_varimu" },
      params: { Intensty: 0.3 },
    },
  });
  const at = join(lib, "modules", "audio", "dynamics", "compressor", "engines");
  writeYaml(join(at, "tracktion", "ui.yaml"), PANEL("Ratio"));
  writeYaml(join(at, "vari-mu", "ui.yaml"), PANEL("Intensty"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const resolved = (name: string) =>
  resolveModule(loadModules(dir)[name], loadModuleRefs(dir));

describe("loading", () => {
  it("loads each engine under its module's ref, and lists them on the module", () => {
    const refs = loadModuleRefs(dir);
    expect(refs[`${COMP}/engines/vari-mu`]?.engineOf).toBe(COMP);
    expect(refs[COMP]?.engineRefs).toEqual({
      tracktion: `${COMP}/engines/tracktion`,
      "vari-mu": `${COMP}/engines/vari-mu`,
    });
  });

  it("never offers an engine as a module of its own", () => {
    const bases = baseModuleRefs(loadModuleRefs(dir));
    expect(bases).toContain(COMP);
    expect(bases.some((r) => r.includes("/engines/"))).toBe(false);
  });

  it("finds each engine's panel in its own folder", () => {
    const panels = loadUiLibrary(dir).byRef;
    expect(panels[`${COMP}/engines/vari-mu`]?.ui.widgets.k.bind).toBe(
      "Intensty",
    );
  });

  it("answers the builder's strip from the module FILE, default first", () => {
    const file = join(
      lib,
      "modules",
      "audio",
      "dynamics",
      "compressor",
      "module.yaml",
    );
    expect(enginesBeside(file)).toEqual({
      engines: ["tracktion", "vari-mu"],
      engine: "tracktion",
    });
  });
});

describe("running as an engine", () => {
  it("runs the default engine, with the module's identity and the engine's panel", () => {
    writeNode(dir, "vox", { extends: COMP });
    const m = resolved("vox");
    expect(m.plugin).toEqual({ type: "internal", name: "compressor" });
    expect(moduleStatusOf(m)).toBe("favorite");
    expect(m.engine).toBe("tracktion");
    expect(
      (m.ui as { widgets: Record<string, { bind: string }> }).widgets.k.bind,
    ).toBe("Ratio");
  });

  it("runs the engine a node picks, and keeps params PER engine", () => {
    writeNode(dir, "vox", {
      extends: COMP,
      engine: "vari-mu",
      engines: {
        tracktion: { params: { Ratio: 0.9 } },
        "vari-mu": { params: { Intensty: 0.8 } },
      },
    });
    const m = resolved("vox");
    expect(m.plugin).toEqual({ type: "internal", name: "airwindows_varimu" });
    // Tracktion's Ratio is not a knob vari-mu has, so it does not leak across.
    expect(m.params).toEqual({ Intensty: 0.8 });
  });

  it("stays a use of its OWN module, whichever engine it runs — what its card names it by", () => {
    writeNode(dir, "vox", { extends: COMP, engine: "vari-mu" });
    expect(resolved("vox").extends).toBe(COMP);
  });

  it("loads the FILE a node sets for its engine, not the engine's default one", () => {
    const ir = join(lib, "irs", "room.wav");
    mkdirSync(join(lib, "irs"), { recursive: true });
    writeFileSync(ir, "", "utf8");
    writeNode(dir, "vox", {
      extends: COMP,
      engines: { tracktion: { params: { ir: "@st0/room.wav" } } },
    });
    const m = resolved("vox");
    expect(m.ir).toBe(ir);
    expect(m.assets).toMatchObject({ ir: "@st0/room.wav" });
  });

  it("falls back to the default for an engine the module has not got", () => {
    writeNode(dir, "vox", { extends: COMP, engine: "nope" });
    expect(resolved("vox").engine).toBe("tracktion");
  });

  it("lets an ALTERNATIVE switch the engine", () => {
    writeNode(dir, "vox", {
      extends: COMP,
      alternative: "warm",
      alternatives: [{ name: "warm", engine: "vari-mu" }],
    });
    expect(resolved("vox").engine).toBe("vari-mu");
  });

  it("puts the list on the graph only when there is a choice", () => {
    writeNode(dir, "vox", { extends: COMP, engine: "vari-mu" });
    const g = loadGraph(dir);
    expect(g.modules.vox?.engines).toEqual(["tracktion", "vari-mu"]);
    expect(g.modules.vox?.engine).toBe("vari-mu");
  });
});
