import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadModuleRefs, loadModules } from "./loader";
import { writeLibrary } from "./testSupport";
import { loadUiLibrary, uiFileText, uiPathFor, writeUiFile } from "./uiLibrary";
import { migrateModuleUis } from "./uiMigrate";
import { UISchema } from "./yaml/moduleSchema";

// A module's panel lives in the workspace's `_ui`, not in the module file: `module populate` can then rebuild
// `_modules` without touching hand-drawn work, and one panel serves every project that inherits the module.
//
// The file's PATH mirrors `_modules` as a filing convenience; the `ref:` inside it is the key. That split is
// what these tests pin down — plus the migration, which has to move a panel without disturbing the rest of a
// module file people hand-edit and keep in git.

const PANEL = {
  cols: 2,
  rows: 1,
  widgets: {
    mix: { type: "knob" as const, col: 0, row: 0, bind: "Mix", label: "Mix" },
  },
};

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ui-"));
  writeLibrary(root);
  dir = join(root, "song");
  mkdirSync(join(dir, "modules", "audio", "reverb"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n  modules_from:\n    - ../_modules\n",
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeLocalModule = (body: string) =>
  writeFileSync(
    join(dir, "modules", "audio", "reverb", "module.yaml"),
    body,
    "utf8",
  );

describe("where a panel files itself", () => {
  it("mirrors the module tree, namespace dropped", () => {
    expect(uiPathFor("@engine/audio/delay/tape-delay")).toBe(
      "audio/delay/tape-delay.yaml",
    );
    expect(uiPathFor("audio/reverb")).toBe("audio/reverb.yaml");
    // An io ref carries no type folder, so it gets one back — otherwise `desk` would land at the library root.
    expect(uiPathFor("desk")).toBe("io/desk.yaml");
  });

  it("steps past a file another ref already holds, and keys on the ref regardless", () => {
    writeUiFile(dir, "@engine/audio/reverb", PANEL);
    const second = writeUiFile(dir, "audio/reverb", PANEL);
    expect(second.endsWith("reverb-2.yaml")).toBe(true);
    const lib = loadUiLibrary(dir);
    expect(Object.keys(lib.byRef).sort()).toEqual([
      "@engine/audio/reverb",
      "audio/reverb",
    ]);
  });

  it("keeps a panel's file where an author moved it", () => {
    const first = writeUiFile(dir, "audio/reverb", PANEL);
    const moved = writeUiFile(dir, "audio/reverb", { ...PANEL, cols: 3 });
    expect(moved).toBe(first);
    expect(loadUiLibrary(dir).byRef["audio/reverb"].ui.cols).toBe(3);
  });

  it("reports a second panel for the same ref instead of picking one silently", () => {
    writeUiFile(dir, "audio/reverb", PANEL);
    writeFileSync(
      join(root, "_ui", "audio", "rival.yaml"),
      'ref: "audio/reverb"\ncols: 1\nrows: 1\nwidgets: {}\n',
      "utf8",
    );
    const lib = loadUiLibrary(dir);
    expect(lib.issues.join()).toMatch(/already has a panel/);
    expect(Object.keys(lib.byRef)).toEqual(["audio/reverb"]);
  });

  it("reports an unreadable panel rather than hiding the rest of the library", () => {
    writeUiFile(dir, "audio/reverb", PANEL);
    writeFileSync(
      join(root, "_ui", "audio", "broken.yaml"),
      "cols: 1\n",
      "utf8",
    ); // no ref
    const lib = loadUiLibrary(dir);
    expect(lib.issues).toHaveLength(1);
    expect(lib.byRef["audio/reverb"]).toBeTruthy();
  });
});

describe("the loader overlays the library", () => {
  it("gives a project's own module its panel", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(loadModules(dir).reverb.ui).toEqual(PANEL);
  });

  it("gives a shared module its panel, through the ref map", () => {
    writeUiFile(dir, "@engine/audio/delay/tape-delay", PANEL);
    const refs = loadModuleRefs(dir, ["../_modules"]);
    expect(refs["@engine/audio/delay/tape-delay"].ui).toEqual(PANEL);
  });

  it("shows a shared generic's panel on its INHERITED instances", () => {
    // `module populate` files one io/IN instance per interface input, and a chain names
    // one of them — so this is the path a live input actually takes. The ref map keys an
    // inherited instance "@engine/io/IN:in-2", which no panel answers to, and the lookup
    // used that key verbatim: the generic's grid reached the generic and nothing else, so
    // every input in the graph drew "No Options" over a panel that was right there.
    mkdirSync(join(root, "_modules", "io", "IN"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "io", "IN", "module.yaml"),
      "io: in\n",
    );
    writeFileSync(
      join(root, "_modules", "io", "IN", "in-2.yaml"),
      "channel: [2]\n",
    );
    writeUiFile(dir, "@engine/io/IN", PANEL);
    const refs = loadModuleRefs(dir, ["../_modules"]);
    expect(refs["@engine/io/IN"].ui).toEqual(PANEL);
    expect(refs["@engine/io/IN:in-2"].ui).toEqual(PANEL);
    // …and the instance keeps what makes it one.
    expect(refs["@engine/io/IN:in-2"].channel).toEqual([2]);
  });

  it("replaces an inline ui whole rather than merging into it", () => {
    writeLocalModule(
      [
        "plugin:",
        "  name: Reverb",
        "  type: vst3",
        "ui:",
        "  cols: 9",
        "  rows: 9",
        "  widgets:",
        "    old: { type: knob, col: 0, row: 0, bind: Old }",
        "",
      ].join("\n"),
    );
    writeUiFile(dir, "audio/reverb", PANEL);
    const ui = loadModules(dir).reverb.ui as typeof PANEL;
    expect(ui.cols).toBe(2);
    expect(Object.keys(ui.widgets)).toEqual(["mix"]); // no trace of the module's own grid
  });

  it("shows a generic's panel on its instances too", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeFileSync(
      join(dir, "modules", "audio", "reverb", "hall.yaml"),
      "params:\n  Mix: 0.9\n",
      "utf8",
    );
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(loadModules(dir)["reverb:hall"].ui).toEqual(PANEL);
  });

  it("leaves modules alone when the workspace has no library", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    expect(loadModules(dir).reverb.ui).toBeUndefined();
  });
});

describe("migrating the panels that are still inline", () => {
  const INLINE = [
    "# A reverb.",
    "plugin:",
    "  name: Reverb",
    "  type: vst3",
    "ui:",
    "  cols: 2",
    "  rows: 1",
    "  widgets:",
    "    mix: { type: knob, col: 0, row: 0, bind: Mix, label: Mix }",
    "params: # kept",
    "  Mix: 0.4",
    "",
  ].join("\n");

  it("moves a project module's panel out and leaves the rest of the file alone", () => {
    writeLocalModule(INLINE);
    const r = migrateModuleUis(dir);
    expect(r.errors).toEqual([]);
    expect(r.moved).toEqual(["audio/reverb → _ui/audio/reverb.yaml"]);

    const after = readFileSync(
      join(dir, "modules", "audio", "reverb", "module.yaml"),
      "utf8",
    );
    expect(after).not.toMatch(/^ui:/m);
    expect(after).toContain("# A reverb."); // comments survive
    // As do trailing keys and theirs — though `yaml`'s round-trip moves an end-of-line comment onto its own
    // line, which is setModuleValue's long-standing behaviour and not something this migration introduces.
    expect(after).toContain("# kept");
    expect(after).toMatch(/Mix: 0\.4/);
    expect(loadModules(dir).reverb.ui).toEqual(PANEL); // and the panel still reaches the module
  });

  it("moves a shared module's panel under its namespaced ref", () => {
    const shared = join(
      root,
      "_modules",
      "audio",
      "delay",
      "tape-delay",
      "module.yaml",
    );
    writeFileSync(
      shared,
      `${readFileSync(shared, "utf8")}ui:\n  cols: 1\n  rows: 1\n  widgets: {}\n`,
    );
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([
      "@engine/audio/delay/tape-delay → _ui/audio/delay/tape-delay.yaml",
    ]);
    expect(readFileSync(shared, "utf8")).not.toMatch(/^ui:/m);
  });

  it("is safe to run twice", () => {
    writeLocalModule(INLINE);
    migrateModuleUis(dir);
    const before = readFileSync(
      join(root, "_ui", "audio", "reverb.yaml"),
      "utf8",
    );
    const again = migrateModuleUis(dir);
    expect(again.moved).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(
      readFileSync(join(root, "_ui", "audio", "reverb.yaml"), "utf8"),
    ).toBe(before);
  });

  it("reports a ui it cannot move rather than dropping it", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\nui:\n  cols: 2\n");
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(r.errors.join()).toMatch(/not a panel this can move/);
    // Still in the file, so nothing was lost.
    expect(
      readFileSync(
        join(dir, "modules", "audio", "reverb", "module.yaml"),
        "utf8",
      ),
    ).toMatch(/^ui:/m);
  });

  it("writes nothing when there is nothing inline", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(existsSync(join(root, "_ui"))).toBe(false);
  });
});

// A panel is written by one half of the editor and read back by the other, so what matters is not that each
// half works but that the text survives the trip. The empty grid is the case that didn't: a bare `widgets:`
// reads back as NULL, the schema refuses null, and the editor reported the file it had just written as
// malformed — on exactly the modules that have no panel yet, which is when the grid is wanted.
describe("a panel file reads back as what was written", () => {
  const roundTrips = (ui: Parameters<typeof uiFileText>[1]) => {
    const raw = parseYaml(uiFileText("@engine/io/IN", ui), { version: "1.2" });
    return UISchema.safeParse({
      cols: raw.cols,
      rows: raw.rows,
      widgets: raw.widgets,
    }).success;
  };

  it("survives with no widgets at all — the scaffold's own shape", () => {
    expect(roundTrips({ cols: 4, rows: 2, widgets: {} })).toBe(true);
  });

  it("survives with widgets, as it always did", () => {
    expect(
      roundTrips({
        cols: 4,
        rows: 2,
        widgets: { gain: { type: "knob", col: 0, row: 0 } },
      }),
    ).toBe(true);
  });
});
