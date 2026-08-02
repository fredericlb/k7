import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import {
  libraryDirs,
  listLibrary,
  listLibraryKinds,
  loadModules,
  resolveLibraryFile,
} from "./loader";
import { compileNodeProject } from "./nodeProject";
import { setModuleAsset } from "./projectEdit";
import { insertChainStepAfter, setYaml, writeModule } from "./testSupport";

// The shared asset library: one folder beside the projects (`_library`), a subfolder per
// kind of asset (`ir/`), and a project that opts in with `libraries_from`. A module names a
// file by its path INSIDE the library, so what the module says is short and survives
// being copied elsewhere — the resolution belongs to the project, not to the module.
//
// This replaced discovery-by-convention (an audio file dropped in the module's own
// folder): one cabinet IR is worth sharing across every module that wants it.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(here, "..", "..", "..", "engine-tray", "songs", "synth-demo");

let root: string; // the workspace
let proj: string; // the project inside it
let lib: string; // the workspace's _library

// A .wav header is never read here (nothing decodes it), but the file has to EXIST —
// that is the whole difference between a resolved reference and a dangling one.
const putIr = (name: string) => writeFileSync(join(lib, "ir", name), "RIFF");

// Give the fixture a convolver module that loads `file` from the library.
function addCabModule(file: string | null): void {
  writeModule(proj, "audio", "cab", {
    plugin: { type: "internal", name: "Impulse Response" },
    ...(file ? { ir: file } : {}),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-lib-"));
  proj = join(root, "song");
  lib = join(root, "_library");
  cpSync(SONG, proj, { recursive: true });
  mkdirSync(join(lib, "ir"), { recursive: true });
  mkdirSync(join(lib, "nam"), { recursive: true });
  putIr("marshall-1960a.wav");
  putIr("vox-ac30.wav");
  writeFileSync(join(lib, "nam", "jcm800.nam"), "{}");
  // Opt the project in, the way a workspace project points at its sibling _modules.
  setYaml(
    join(proj, "project.yaml"),
    ["project", "libraries_from"],
    ["../_library"],
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("the shared asset library", () => {
  it("finds the folder the project points at", () => {
    expect(libraryDirs(proj)).toEqual([lib]);
    expect(listLibraryKinds(proj)).toEqual(["ir", "nam"]);
    expect(listLibrary(proj, "ir")).toEqual([
      "ir/marshall-1960a.wav",
      "ir/vox-ac30.wav",
    ]);
  });

  it("has none when the project declares none", () => {
    // The fixture's siblings don't opt in, and a library is not implied by being next to
    // one — a project says what it uses.
    const other = join(root, "other");
    cpSync(SONG, other, { recursive: true });
    expect(libraryDirs(other)).toEqual([]);
    expect(listLibrary(other, "ir")).toEqual([]);
  });

  it("refuses a path that climbs out of the library", () => {
    // These come from files an editor writes into a workspace that may be shared, so a
    // reference is resolved INSIDE the library or not at all.
    writeFileSync(join(root, "secret.wav"), "RIFF");
    expect(resolveLibraryFile("../secret.wav", [lib])).toBeUndefined();
    expect(resolveLibraryFile("ir/marshall-1960a.wav", [lib])).toBe(
      join(lib, "ir", "marshall-1960a.wav"),
    );
    // …and a name the library doesn't hold resolves to nothing rather than to a path
    // that isn't there.
    expect(resolveLibraryFile("ir/nope.wav", [lib])).toBeUndefined();
  });

  it("resolves a module's `ir` to the library file, keeping the name it was given", () => {
    addCabModule("ir/marshall-1960a.wav");
    const cab = loadModules(proj).cab;
    expect(cab.ir).toBe(join(lib, "ir", "marshall-1960a.wav"));
    // The short name survives: it is what the module editor shows as the current choice.
    expect(cab.assets).toEqual({ ir: "ir/marshall-1960a.wav" });
  });

  it("compiles that absolute path into the plugin the engine builds", () => {
    addCabModule("ir/vox-ac30.wav");
    // Put it in a chain, or the module compiles to nothing.
    insertChainStepAfter(proj, "synth", { module: "cab" });

    const melody = compileNodeProject(proj).tracks.find(
      (t) => t.id === "melody",
    );
    const cab = melody?.plugins.find((p) => p.id.endsWith(":cab"));
    expect(cab?.irFile).toBe(join(lib, "ir", "vox-ac30.wav"));
  });

  it("warns about a reference the library doesn't hold, instead of loading nothing", () => {
    // Silence with no explanation is the failure mode worth spending a warning on: a
    // convolver with no impulse response passes no sound at all.
    addCabModule("ir/does-not-exist.wav");
    const w = loadGraph(proj).warnings;
    expect(w.some((m) => m.includes("does-not-exist.wav"))).toBe(true);
  });

  it("writes a pick into the module's own file, and clears it again", () => {
    addCabModule(null);
    const file = join(proj, "modules", "audio", "cab", "module.yaml");

    setModuleAsset(proj, "cab", "ir", "ir/marshall-1960a.wav");
    expect(readFileSync(file, "utf8")).toContain("ir/marshall-1960a.wav");
    expect(loadModules(proj).cab.assets?.ir).toBe("ir/marshall-1960a.wav");

    // Choosing another replaces it rather than adding a second `ir:`.
    setModuleAsset(proj, "cab", "ir", "ir/vox-ac30.wav");
    const swapped = readFileSync(file, "utf8");
    expect(swapped).toContain("ir/vox-ac30.wav");
    expect(swapped).not.toContain("marshall");

    // Clearing takes the field away — a convolver with no IR is a legitimate state, and
    // `ir: ""` would be a value that means nothing.
    setModuleAsset(proj, "cab", "ir", null);
    expect(readFileSync(file, "utf8")).not.toContain("ir:");
    expect(loadModules(proj).cab.assets).toBeUndefined();
  });

  it("lets an instance carry its own cabinet", () => {
    // Two amps sharing one convolver module, each with its own speaker — the reason the
    // IR is a field rather than a file dropped in the module's folder (which every
    // instance would have had to share).
    addCabModule("ir/marshall-1960a.wav");
    writeModule(proj, "audio", "cab", { ir: "ir/vox-ac30.wav" }, "clean");
    const mods = loadModules(proj);
    expect(mods.cab.assets?.ir).toBe("ir/marshall-1960a.wav");
    expect(mods["cab:clean"].assets?.ir).toBe("ir/vox-ac30.wav");
  });

  it("carries a .nam model the same way, into its own plugin field", () => {
    // The asset mechanism is one mechanism: the field names the library folder AND the
    // command that sets it. A second kind should cost a folder and a field, nothing more.
    writeModule(proj, "audio", "amp", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      nam: "nam/jcm800.nam",
    });
    insertChainStepAfter(proj, "synth", { module: "amp" });

    expect(loadModules(proj).amp.assets).toEqual({ nam: "nam/jcm800.nam" });
    const melody = compileNodeProject(proj).tracks.find(
      (t) => t.id === "melody",
    );
    const amp = melody?.plugins.find((p) => p.id.endsWith(":amp"));
    // Its OWN field — an amp model is not an impulse response, and the engine hands
    // each to a different plugin.
    expect(amp?.namFile).toBe(join(lib, "nam", "jcm800.nam"));
    expect(amp?.irFile).toBeUndefined();
  });

  it("only offers a folder's own kind of file", () => {
    // A .wav in nam/ is not a model, and a .nam in ir/ is not an impulse response —
    // offering them would just be a way to pick something that can't load.
    writeFileSync(join(lib, "nam", "notes.wav"), "RIFF");
    expect(listLibrary(proj, "nam")).toEqual(["nam/jcm800.nam"]);
  });

  it("lets a module UI carry a library dropdown", () => {
    // This was reported as "ui.widgets.w2.library: field not allowed" — a whole graph down
    // because one widget field was missing from the schema that validates modules. There
    // used to be TWO copies of that schema (the shipped one and a generated overlay, which
    // was the enforced one), and adding the field to the shipped copy alone changed
    // nothing. One schema now, so the case is a single assertion — but still worth pinning:
    // the failure was total, not local to the widget.
    writeModule(proj, "audio", "amp", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      nam: "nam/jcm800.nam",
      ui: {
        cols: 4,
        rows: 2,
        widgets: {
          w2: {
            type: "dropdown",
            col: 0,
            row: 0,
            colSpan: 4,
            library: "nam",
            bind: "nam",
          },
        },
      },
    });

    expect(() => loadModules(proj, true)).not.toThrow();
    const ui = loadModules(proj).amp.ui as {
      widgets: Record<string, { library?: string }>;
    };
    expect(ui.widgets.w2.library).toBe("nam");
  });
});
