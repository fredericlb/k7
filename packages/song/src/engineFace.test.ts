import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  engineFaceModule,
  engineFaces,
  FACE_CATEGORIES,
  faceFolder,
} from "./engineFace";
import { loadModuleRefs } from "./loader";
import { resolveModule } from "./moduleResolve";
import type { LoadedModule } from "./rawDoc";
import { loadUiLibrary } from "./uiLibrary";

// Giving a SCANNED PLUGIN a face, the way docs/moduleNamespaces.md says it happens: not by copying it into
// every project that plays it, but by a `@st0` module that EXTENDS the `@engine` ref and holds the panel.
//
// The point these tests pin down is where the resolution happens. A médiathèque module's `extends` is not
// resolved by the médiathèque — a library has no project.yaml, no modules_from, and no engine to ask. It is
// resolved by the PROJECT that loads it, whose ref map holds the scanned catalogue and the library at once.
// That is what makes the arrangement work with a library that is somebody else's repository, mounted in the
// workspace at `_libraries/modules` and carrying no idea of the project it will be read by.

const SLUG = "@engine/serum";

// The scan cache is ambient — what this machine happens to have — so it is injected, as loadModuleRefs takes it.
const CATALOGUE = {
  [SLUG]: {
    plugin: { type: "vst3", name: "Serum" },
    kind: "plugin",
    inputs: [],
    category: "instruments",
    file: "serum",
  },
} as unknown as Record<string, LoadedModule>;

let ws: string;
/** The library's modules, mounted in the workspace: `<ws>/_libraries/modules` — the `@st0` level. */
let media: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-face-"));
  media = join(ws, "_libraries");
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n  modules_from: [ '@st0' ]\n",
    "utf8",
  );
  // The médiathèque module: it adds NOTHING but a name and a face. `extends` is the whole substance.
  const folder = join(media, "modules", "instruments", "serum");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "module.yaml"), `extends: "${SLUG}"\n`, "utf8");
  writeFileSync(
    join(folder, "ui.yaml"),
    "cols: 2\nrows: 1\nwidgets:\n  cutoff: { type: knob, col: 0, row: 0, bind: Cutoff, label: Cutoff }\n",
    "utf8",
  );
});
afterEach(() => {
  // The library sits inside the workspace, so removing that removes it too.
  rmSync(ws, { recursive: true, force: true });
});

const refs = () => loadModuleRefs(dir, CATALOGUE);

describe("a scanned plugin's face lives in the médiathèque", () => {
  it("keys the library module and the engine module side by side", () => {
    // Both levels in one map is the precondition for the `extends` below to resolve at all.
    const all = refs();
    expect(all["@st0/instruments/serum"]).toBeTruthy();
    expect(all[SLUG]).toBeTruthy();
  });

  it("inherits the plugin from the engine ref it extends", () => {
    // The médiathèque module declares no `plugin:` of its own — the scan is what knows it. If this
    // resolved to nothing the project would draw a face over a module that loads no plugin at all.
    const all = refs();
    const m = resolveModule(all["@st0/instruments/serum"], all);
    expect(m.plugin).toMatchObject({ type: "vst3", name: "Serum" });
  });

  it("keeps the level it is filed at, rather than the one it inherits from", () => {
    // `category` is OWN_ONLY: the folder a module sits in decides its icon and its ports, and an
    // inherited category would file the médiathèque's copy wherever the engine happened to report.
    const all = refs();
    const m = resolveModule(all["@st0/instruments/serum"], all);
    expect(m.category).toBe("instruments");
  });

  it("draws the panel the médiathèque holds, for a plugin with no folder of its own", () => {
    // The face is the reason the module exists. `@engine/serum` can carry no ui.yaml — writeUiFile
    // refuses it, having no folder to write into — so it is the library module that holds one.
    const panel = loadUiLibrary(dir).byRef["@st0/instruments/serum"];
    expect(panel?.ui.widgets.cutoff).toMatchObject({ bind: "Cutoff" });
  });

  it("reaches the module itself, not just the panel map", () => {
    // loadModuleRefs overlays the panels onto the modules it keys, which is what a project compiles from.
    expect(refs()["@st0/instruments/serum"].ui).toMatchObject({
      cols: 2,
      rows: 1,
    });
  });

  it("resolves the library ref on a project header that says nothing at all", () => {
    // The reason this matters: `modules_from` was only ever written by the scaffold, so every
    // project older than that line saw the médiathèque as a dangling ref — "extends unknown
    // module '@st0/…'" about a module sitting right there on disk. The level's folder is
    // fixed, so the declaration stated nothing the loader did not already know, and it is gone.
    writeFileSync(
      join(dir, "project.yaml"),
      "project:\n  name: song\n  tempo: 120\n",
      "utf8",
    );
    const all = loadModuleRefs(dir, CATALOGUE);
    expect(all["@st0/instruments/serum"]).toBeTruthy();
    // …and its face comes with it: a module the loader keys but whose panel is only reached
    // through the declaration would resolve and then draw nothing.
    expect(loadUiLibrary(dir).byRef["@st0/instruments/serum"]).toBeTruthy();
  });

  it("survives a machine that has never scanned", () => {
    // The catalogue is ambient. With none, the `extends` names nothing — and that must cost the
    // inheritance, not the project: validate() is what reports a dangling ref, not the loader.
    const all = loadModuleRefs(dir, {});
    const m = resolveModule(all["@st0/instruments/serum"], all);
    expect(m.plugin).toBeUndefined();
    expect(m.category).toBe("instruments"); // still filed where it sits
  });
});

describe("scaffolding that module", () => {
  it("writes nothing but the ref it inherits from", () => {
    // The scan already knows what the plugin is. A `plugin:` block copied in here would be a second
    // copy of that, staler the moment the plugin is updated.
    const f = engineFaceModule("Serum", "instruments");
    expect(f.base).toBe("@engine/serum");
    expect(f.path).toBe("instruments/serum/module.yaml");
    expect(f.text).toContain('extends: "@engine/serum"');
    expect(f.text).not.toContain("plugin:");
  });

  it("produces exactly what the loader then resolves", () => {
    // The pair that must not drift: this writes the file, and the test above loads one written by
    // hand. Writing the scaffold into the library proves they are the same file.
    const f = engineFaceModule("Serum", "instruments");
    const at = join(media, "modules", f.path);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, f.text, "utf8");
    const all = refs();
    const m = resolveModule(
      all[`@st0/${f.path.replace(/\/module\.yaml$/, "")}`],
      all,
    );
    expect(m.plugin).toMatchObject({ name: "Serum" });
  });

  it("keeps the plugin's real name where a reader can find it", () => {
    // The slug is lossy: "Pro-Q 3" and "Pro Q3" slug alike, and a year later the folder name is not
    // enough to say which plugin this file stands for.
    expect(engineFaceModule("FabFilter Pro-Q 3", "audio").text).toContain(
      "FabFilter Pro-Q 3",
    );
  });

  it("refuses a category a plugin cannot be filed under", () => {
    // `io` is the engine's own IN/OUT — a scanned plugin is never one, and a module filed there
    // would take io's ports and load nothing.
    expect(() => engineFaceModule("Serum", "io")).toThrow(/not a category/);
    expect(() => engineFaceModule("Serum", "nonsense")).toThrow(
      /not a category/,
    );
    expect(FACE_CATEGORIES).not.toContain("io");
  });

  it("refuses a name that leaves no folder to make", () => {
    expect(() => engineFaceModule("!!!", "audio")).toThrow(/no name/);
  });
});

describe("filing a whole scan at once", () => {
  it("puts a plugin on the axis the library already files by", () => {
    // The scan's own category, LAST segment: the first repeats the type folder — every effect
    // says `Fx` — and what tells them apart is what follows. `audio/distortion` and
    // `audio/filter` are folders somebody made by hand before any of this existed.
    expect(faceFolder("Fx|Delay")).toBe("delay");
    expect(faceFolder("instrument|synth")).toBe("synth");
    expect(faceFolder("dynamics")).toBe("dynamics");
    // …and nothing when it only repeats the type, or says nothing at all.
    expect(faceFolder("Fx")).toBe("");
    expect(faceFolder("instrument")).toBe("");
    expect(faceFolder(undefined)).toBe("");
  });

  it("files each plugin by its role and its category", () => {
    const faces = engineFaces([
      { name: "ADClip 7", role: "audioEffect", category: "dynamics" },
      { name: "ARP 2600 V3", role: "instrument", category: "instrument|synth" },
      { name: "Arp", role: "midiEffect" },
    ]);
    expect(faces.map((f) => f.path)).toEqual([
      "audio/dynamics/adclip-7/module.yaml",
      "instruments/synth/arp-2600-v3/module.yaml",
      "transformers/arp/module.yaml",
    ]);
  });

  it("skips a plugin the library already has a face for", () => {
    // By REF and not by path: `audio/distortion/bitcrush` extending `@engine/de-rez` is that
    // plugin's face under a name somebody chose, and a second one at the default path would give
    // one plugin two names a chain could reach it by.
    const faces = engineFaces(
      [
        { name: "de-rez", category: "distortion" },
        { name: "Bite", category: "distortion" },
      ],
      ["@engine/de-rez"],
    );
    expect(faces.map((f) => f.base)).toEqual(["@engine/bite"]);
  });

  it("collapses two scans of one plugin, and drops what cannot be slugged", () => {
    // The identical rule `engineModules` applies to the catalogue these refs point INTO — it has
    // to be identical, or a face would name a ref nothing synthesises.
    const faces = engineFaces([
      { name: "Chorus", category: "modulation" },
      { name: "chorus", category: "modulation" },
      { name: "!!!" },
    ]);
    expect(faces.map((f) => f.base)).toEqual(["@engine/chorus"]);
  });

  it("is idempotent — a second pass over the same scan writes nothing", () => {
    const scan = [
      { name: "ADClip 7", role: "audioEffect", category: "dynamics" },
      { name: "Bite", category: "distortion" },
    ];
    const first = engineFaces(scan);
    expect(
      engineFaces(
        scan,
        first.map((f) => f.base),
      ),
    ).toEqual([]);
  });
});
