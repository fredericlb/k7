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
import { UISchema } from "@studio/song-schema/yaml/moduleSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadModuleRefs, loadModules } from "./loader";
import { writeLibraries, writeLibrary, writeYaml } from "./testSupport";
import { loadUiLibrary, uiFileText, uiPathFor, writeUiFile } from "./uiLibrary";
import { migrateModuleUis } from "./uiMigrate";

// A panel is the `ui.yaml` in the module's own FOLDER, which is the key: no `ref:` can disagree with it.

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
  // A SECOND library at `_libraries/modules`, answering to `@st0` by its folder and no config.
  let media: string;
  beforeEach(() => {
    media = join(root, "_libraries");
    writeLibraries(root);
  });

  it("loads a module OUT of the media library, through the @st0 token", () => {
    // The project reaches a library it does not contain, with no path anywhere in project.yaml.
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
    // A panel is drawn for the plugin, so it lands where the plugin is, not in every project.
    const written = writeUiFile(dir, "@st0/audio/reverb", PANEL);
    expect(written).toBe(join(media, "modules", "audio", "reverb", "ui.yaml"));
    expect(loadUiLibrary(dir).byRef["@st0/audio/reverb"]?.ui).toEqual(PANEL);
  });

  it("refuses a namespace no library this project can see declares", () => {
    // Guessing a root files the panel under a module that is not there: a save that draws nothing.
    expect(() => writeUiFile(dir, "@nowhere/audio/reverb", PANEL)).toThrow(
      /@nowhere/,
    );
  });

  it("lets the project's own panel win, without calling it a mistake", () => {
    // One NAME in two libraries is a fork, so both are keyed and the local module picks.
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
    // An io ref carries no type folder, so it gets one back from the REF's shape.
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
    // Every `<name>.yaml` in a module folder is a use, so an unguarded one reads as "reverb:ui".
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
    // A verbatim lookup of "@workspace/io/IN:in-2" found no panel, so every input drew "No Options".
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
    // A node has no ref of its own to be filed under, so it is looked up by what it extends.
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
    // As do trailing keys, though the round-trip moves an end-of-line comment onto its own line.
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

// A bare `widgets:` read back as NULL, so the editor called the file it had just written malformed.
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
