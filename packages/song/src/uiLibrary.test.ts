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
import { writeLibraries, writeLibrary, writeYaml } from "./testSupport";
import { loadUiLibrary, uiFileText, uiPathFor, writeUiFile } from "./uiLibrary";
import { migrateModuleUis } from "./uiMigrate";
import { UISchema } from "./yaml/moduleSchema";

// A module's panel is the `ui.yaml` in its own folder, beside `module.yaml`: the plugin scan can rewrite what a
// module IS without touching how it is DRAWN, and one panel serves every project that inherits the module.
//
// The FOLDER is the key — there is no `ref:` in the file to disagree with it — and every library the project can
// see is read, nearest first. That is what these tests pin down, plus the migration, which has to move a panel
// without disturbing the rest of a module file people hand-edit and keep in git.

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

describe("panels across more than one library", () => {
  // A SECOND module library beside the workspace's own `_modules`: the account's library
  // submodule, mounted at `_libraries/modules`. It answers to `@st0` because of the folder it
  // sits in — no config, no declaration — and reaching its panels through that is what these
  // pin down.
  let media: string;
  beforeEach(() => {
    media = join(root, "_libraries");
    writeLibraries(root);
  });

  it("loads a module OUT of the media library, through the @st0 token", () => {
    // The end of the chain this step exists for: the project reaches a library it does not
    // contain, and the module resolves — with no path anywhere in project.yaml.
    const refs = loadModuleRefs(dir);
    expect(refs["@st0/audio/reverb"]).toBeTruthy();
    expect(refs["@workspace/audio/delay/tape-delay"]).toBeTruthy();
  });

  it("finds a panel beside a module in a declared library", () => {
    writeYaml(
      join(media, "modules", "audio", "reverb", "ui.yaml"),
      PANEL as unknown as Record<string, unknown>,
    );
    expect(loadUiLibrary(dir).byRef["@st0/audio/reverb"]?.ui).toEqual(PANEL);
  });

  it("writes a shared module's panel into the shared module's own folder", () => {
    // The rule that changed: a panel is drawn for the plugin, so it lands where the plugin is
    // rather than being copied into every project that plays it.
    const written = writeUiFile(dir, "@st0/audio/reverb", PANEL);
    expect(written).toBe(join(media, "modules", "audio", "reverb", "ui.yaml"));
    expect(loadUiLibrary(dir).byRef["@st0/audio/reverb"]?.ui).toEqual(PANEL);
  });

  it("refuses a namespace no library this project can see declares", () => {
    // Guessing a root would file the panel under a module that isn't there — a save that
    // reports success and draws nothing.
    expect(() => writeUiFile(dir, "@nowhere/audio/reverb", PANEL)).toThrow(
      /@nowhere/,
    );
  });

  it("lets the project's own panel win, without calling it a mistake", () => {
    // The same NAME in two libraries is precedence, not a collision: it is what a fork looks
    // like. The refs differ, so both are keyed — what matters is which one a local module draws.
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "@st0/audio/reverb", { ...PANEL, cols: 9 });
    writeUiFile(dir, "audio/reverb", PANEL);
    const lib = loadUiLibrary(dir);
    expect(lib.byRef["audio/reverb"].ui.cols).toBe(PANEL.cols);
    expect(lib.byRef["@st0/audio/reverb"].ui.cols).toBe(9);
    expect(lib.issues).toEqual([]);
    expect(loadModules(dir).reverb.ui).toEqual(PANEL);
  });
});

describe("where a panel files itself", () => {
  it("sits in the module's own folder, namespace dropped", () => {
    expect(uiPathFor("@workspace/audio/delay/tape-delay")).toBe(
      "audio/delay/tape-delay/ui.yaml",
    );
    expect(uiPathFor("audio/reverb")).toBe("audio/reverb/ui.yaml");
    // An io ref carries no type folder, so it still gets one back — that rescue is about the
    // REF's shape, not about the tree the file used to live in.
    expect(uiPathFor("desk")).toBe("io/desk/ui.yaml");
  });

  it("writes a local panel beside its module, and reads it back", () => {
    const written = writeUiFile(dir, "audio/reverb", PANEL);
    expect(written).toBe(join(dir, "modules", "audio", "reverb", "ui.yaml"));
    expect(loadUiLibrary(dir).byRef["audio/reverb"].ui).toEqual(PANEL);
  });

  it("overwrites the module's existing panel rather than filing a second one", () => {
    const first = writeUiFile(dir, "audio/reverb", PANEL);
    const again = writeUiFile(dir, "audio/reverb", { ...PANEL, cols: 3 });
    expect(again).toBe(first);
    expect(loadUiLibrary(dir).byRef["audio/reverb"].ui.cols).toBe(3);
  });

  it("keys two modules of the same name under two libraries separately", () => {
    writeUiFile(dir, "@workspace/audio/delay/tape-delay", PANEL);
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(Object.keys(loadUiLibrary(dir).byRef).sort()).toEqual([
      "@workspace/audio/delay/tape-delay",
      "audio/reverb",
    ]);
  });

  it("reports an unreadable panel rather than hiding the rest of the library", () => {
    writeUiFile(dir, "audio/reverb", PANEL);
    mkdirSync(join(dir, "modules", "audio", "broken"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "broken", "ui.yaml"),
      "cols: nope\n",
      "utf8",
    );
    const lib = loadUiLibrary(dir);
    expect(lib.issues).toHaveLength(1);
    expect(lib.byRef["audio/reverb"]).toBeTruthy();
  });

  it("is not read as a node of the module it sits beside", () => {
    // THE hazard of the move: every `<name>.yaml` in a module folder is one use of the module,
    // so an unguarded `ui.yaml` would come back as a module called "reverb:ui".
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(Object.keys(loadModules(dir))).toEqual(["reverb"]);
  });
});

describe("the loader overlays the panels", () => {
  it("gives a project's own module its panel", () => {
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(loadModules(dir).reverb.ui).toEqual(PANEL);
  });

  it("gives a shared module its panel, through the ref map", () => {
    writeUiFile(dir, "@workspace/audio/delay/tape-delay", PANEL);
    const refs = loadModuleRefs(dir);
    expect(refs["@workspace/audio/delay/tape-delay"].ui).toEqual(PANEL);
  });

  it("shows a shared generic's panel on its INHERITED nodes", () => {
    // `module populate` files one io/IN node per interface input, and a chain names
    // one of them — so this is the path a live input actually takes. The ref map keys an
    // inherited node "@workspace/io/IN:in-2", which no panel answers to, and the lookup
    // used that key verbatim: the generic's grid reached the generic and nothing else, so
    // every input in the graph drew "No Options" over a panel that was right there.
    writeFileSync(
      join(root, "_modules", "io", "IN", "in-2.yaml"),
      "channel: [2]\n",
    );
    writeUiFile(dir, "@workspace/io/IN", PANEL);
    const refs = loadModuleRefs(dir);
    expect(refs["@workspace/io/IN"].ui).toEqual(PANEL);
    expect(refs["@workspace/io/IN:in-2"].ui).toEqual(PANEL);
    // …and the node keeps what makes it one.
    expect(refs["@workspace/io/IN:in-2"].channel).toEqual([2]);
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

  it("shows a module's panel on the nodes that use it", () => {
    // A panel is drawn for the MODULE, and every use of it gets that panel — a node has
    // no ref of its own to be filed under, so it is looked up by what it extends.
    writeLocalModule("plugin:\n  name: Reverb\n  type: vst3\n");
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "hall.yaml"),
      'extends: "@project/audio/reverb"\nparams:\n  Mix: 0.9\n',
      "utf8",
    );
    writeUiFile(dir, "audio/reverb", PANEL);
    expect(loadModules(dir).hall.ui).toEqual(PANEL);
  });

  it("leaves modules alone when nothing has been drawn", () => {
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
    expect(r.moved).toEqual(["audio/reverb → modules/audio/reverb/ui.yaml"]);

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

  it("moves a shared module's panel into the shared module's folder", () => {
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
      "@workspace/audio/delay/tape-delay → _modules/audio/delay/tape-delay/ui.yaml",
    ]);
    expect(readFileSync(shared, "utf8")).not.toMatch(/^ui:/m);
  });

  it("is safe to run twice", () => {
    writeLocalModule(INLINE);
    migrateModuleUis(dir);
    const panel = join(dir, "modules", "audio", "reverb", "ui.yaml");
    const before = readFileSync(panel, "utf8");
    const again = migrateModuleUis(dir);
    expect(again.moved).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(readFileSync(panel, "utf8")).toBe(before);
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
    expect(existsSync(join(dir, "modules", "audio", "reverb", "ui.yaml"))).toBe(
      false,
    );
  });
});

// A panel is written by one half of the editor and read back by the other, so what matters is not that each
// half works but that the text survives the trip. The empty grid is the case that didn't: a bare `widgets:`
// reads back as NULL, the schema refuses null, and the editor reported the file it had just written as
// malformed — on exactly the modules that have no panel yet, which is when the grid is wanted.
describe("a panel file reads back as what was written", () => {
  const roundTrips = (ui: Parameters<typeof uiFileText>[0]) =>
    UISchema.safeParse(parseYaml(uiFileText(ui), { version: "1.2" })).success;

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
