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
import { librariesFixture } from "./testSupport";
import { loadUiLibrary } from "./uiLibrary";

// A scanned plugin's face is a `@k7-core` module extending `@engine`, resolved by the PROJECT that loads it.

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
/** The library's modules, mounted in the workspace: `<ws>/_libraries/modules` — the `@k7-core` level. */
let media: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-face-"));
  media = librariesFixture(ws);
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n  modules_from: [ '@k7-core' ]\n",
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
    expect(all["@k7-core/instruments/serum"]).toBeTruthy();
    expect(all[SLUG]).toBeTruthy();
  });

  it("inherits the plugin from the engine ref it extends", () => {
    // The library module declares no `plugin:`, so failing here draws a face over nothing.
    const all = refs();
    const m = resolveModule(all["@k7-core/instruments/serum"], all);
    expect(m.plugin).toMatchObject({ type: "vst3", name: "Serum" });
  });

  it("keeps the level it is filed at, rather than the one it inherits from", () => {
    // `category` is OWN_ONLY, or the library's copy is filed wherever the engine happened to report.
    const all = refs();
    const m = resolveModule(all["@k7-core/instruments/serum"], all);
    expect(m.category).toBe("instruments");
  });

  it("draws the panel the médiathèque holds, for a plugin with no folder of its own", () => {
    // `@engine/serum` has no folder to write a ui.yaml into, so the library module holds the panel.
    const panel = loadUiLibrary(dir).byRef["@k7-core/instruments/serum"];
    expect(panel?.ui.widgets.cutoff).toMatchObject({ bind: "Cutoff" });
  });

  it("reaches the module itself, not just the panel map", () => {
    // loadModuleRefs overlays the panels onto the modules it keys, which is what a project compiles from.
    expect(refs()["@k7-core/instruments/serum"].ui).toMatchObject({
      cols: 2,
      rows: 1,
    });
  });

  it("resolves the library ref on a project header that says nothing at all", () => {
    // No header field declares the library, so a bare header still has to resolve `@k7-core/…`.
    writeFileSync(
      join(dir, "project.yaml"),
      "project:\n  name: song\n  tempo: 120\n",
      "utf8",
    );
    const all = loadModuleRefs(dir, CATALOGUE);
    expect(all["@k7-core/instruments/serum"]).toBeTruthy();
    // …and its face comes with it, or the module resolves and then draws nothing.
    expect(loadUiLibrary(dir).byRef["@k7-core/instruments/serum"]).toBeTruthy();
  });

  it("survives a machine that has never scanned", () => {
    // An unresolved `extends` costs the inheritance, not the project: validate() reports it.
    const all = loadModuleRefs(dir, {});
    const m = resolveModule(all["@k7-core/instruments/serum"], all);
    expect(m.plugin).toBeUndefined();
    expect(m.category).toBe("instruments"); // still filed where it sits
  });
});

describe("scaffolding that module", () => {
  it("writes nothing but the ref it inherits from", () => {
    // A `plugin:` block copied in here is a second copy of the scan, stale on the next update.
    const f = engineFaceModule("Serum", "instruments");
    expect(f.base).toBe("@engine/serum");
    expect(f.path).toBe("instruments/serum/module.yaml");
    expect(f.text).toContain('extends: "@engine/serum"');
    expect(f.text).not.toContain("plugin:");
  });

  it("produces exactly what the loader then resolves", () => {
    // The pair that must not drift: the test above loads the same file written by hand.
    const f = engineFaceModule("Serum", "instruments");
    const at = join(media, "modules", f.path);
    mkdirSync(join(at, ".."), { recursive: true });
    writeFileSync(at, f.text, "utf8");
    const all = refs();
    const m = resolveModule(
      all[`@k7-core/${f.path.replace(/\/module\.yaml$/, "")}`],
      all,
    );
    expect(m.plugin).toMatchObject({ name: "Serum" });
  });

  it("keeps the plugin's real name where a reader can find it", () => {
    // The slug is lossy — "Pro-Q 3" and "Pro Q3" slug alike — so the folder name cannot say which.
    expect(engineFaceModule("FabFilter Pro-Q 3", "audio").text).toContain(
      "FabFilter Pro-Q 3",
    );
  });

  it("refuses a category a plugin cannot be filed under", () => {
    // `io` is the engine's own IN/OUT: a module filed there takes io's ports and loads nothing.
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
    // The LAST segment: the first only repeats the type folder, since every effect says `Fx`.
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
    // By REF and not by path, or a renamed face plus a default one give one plugin two names.
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
    // The same rule `engineModules` applies, or a face names a ref nothing synthesises.
    const faces = engineFaces([
      { name: "Chorus", category: "modulation" },
      { name: "chorus", category: "modulation" },
      { name: "!!!" },
    ]);
    expect(faces.map((f) => f.base)).toEqual(["@engine/chorus"]);
  });

  it("gives the Sampler no face: only a rack loads sounds into it", () => {
    expect(() => engineFaceModule("Sampler", "instruments")).toThrow(/rack/);
    const faces = engineFaces([
      { name: "Sampler", role: "instrument" },
      { name: "4OSC", role: "instrument" },
    ]);
    expect(faces.map((f) => f.base)).toEqual(["@engine/4osc"]);
  });

  it("gives no face to a patch bay either: its routing is state a module cannot set", () => {
    expect(() => engineFaceModule("MIDI Patch Bay", "transformers")).toThrow(
      /channel map/,
    );
    const faces = engineFaces([
      { name: "MIDI Patch Bay", role: "midiEffect" },
      { name: "Patch Bay", role: "audioEffect", category: "utility" },
      { name: "Aux Send", role: "audioEffect", category: "utility" },
      { name: "Freeze Point", role: "audioEffect", category: "utility" },
      { name: "VCA", role: "audioEffect", category: "utility" },
    ]);
    expect(faces.map((f) => f.base)).toEqual(["@engine/vca"]);
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
