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
import { resolvedUI } from "./moduleResolve";
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
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// A module at `@workspace`, spelled out rather than built by a production writer — a module now
// lives at `@workspace` or `@st0`, never inside the project.
const writeSharedModule = (body: string): void => {
  mkdirSync(join(root, "_modules", "audio", "reverb"), { recursive: true });
  writeFileSync(
    join(root, "_modules", "audio", "reverb", "module.yaml"),
    body,
    "utf8",
  );
};

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

  it("keeps two modules of the same name apart, one per level", () => {
    // One NAME in two libraries is a fork, so both are keyed separately, nearest first.
    writeUiFile(dir, "@st0/audio/reverb", { ...PANEL, cols: 9 });
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const lib = loadUiLibrary(dir);
    expect(lib.byRef["@workspace/audio/reverb"].ui.cols).toBe(PANEL.cols);
    expect(lib.byRef["@st0/audio/reverb"].ui.cols).toBe(9);
    expect(lib.issues).toEqual([]);
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

  it("overwrites the module's existing panel rather than filing a second one", () => {
    const first = writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const again = writeUiFile(dir, "@workspace/audio/reverb", {
      ...PANEL,
      cols: 3,
    });
    expect(again).toBe(first);
    expect(loadUiLibrary(dir).byRef["@workspace/audio/reverb"].ui.cols).toBe(3);
  });

  it("reports an unreadable panel rather than hiding the rest of the library", () => {
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    mkdirSync(join(root, "_modules", "audio", "broken"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "broken", "ui.yaml"),
      "cols: nope\n",
      "utf8",
    );
    const lib = loadUiLibrary(dir);
    expect(lib.issues).toHaveLength(1);
    expect(lib.byRef["@workspace/audio/reverb"]).toBeTruthy();
  });

  it("is not read as a node of the module it sits beside", () => {
    // Every `<name>.yaml` in a module folder is a use, so an unguarded one reads as "reverb:ui".
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const refs = loadModuleRefs(dir);
    expect(refs["@workspace/audio/reverb"]).toBeTruthy();
    expect(refs["@workspace/audio/reverb:ui"]).toBeUndefined();
  });
});

describe("the loader overlays the panels", () => {
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
    writeSharedModule(
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
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const ui = loadModuleRefs(dir)["@workspace/audio/reverb"]
      .ui as typeof PANEL;
    expect(ui.cols).toBe(2);
    expect(Object.keys(ui.widgets)).toEqual(["mix"]); // no trace of the module's own grid
  });

  it("shows a module's panel on the nodes that use it", () => {
    // A node has no ref of its own to be filed under, so it is looked up by what it extends.
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "hall.yaml"),
      'extends: "@workspace/audio/reverb"\nparams:\n  Mix: 0.9\n',
      "utf8",
    );
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    expect(loadModules(dir).hall.ui).toEqual(PANEL);
  });

  it("leaves modules alone when nothing has been drawn", () => {
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    expect(loadModuleRefs(dir)["@workspace/audio/reverb"].ui).toBeUndefined();
  });
});

describe("a panel's widgets.js", () => {
  const SCRIPT = "export default { screen(lcd) {} };\n";
  const LCD = {
    cols: 2,
    rows: 1,
    widgets: { screen: { type: "lcdscreen" as const, col: 0, row: 0 } },
  };
  const withScript = (): void => {
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "@workspace/audio/reverb", LCD);
    writeFileSync(
      join(root, "_modules", "audio", "reverb", "widgets.js"),
      SCRIPT,
      "utf8",
    );
  };

  it("rides on the panel it sits beside, as text", () => {
    withScript();
    const ui = loadModuleRefs(dir)["@workspace/audio/reverb"].ui as {
      script?: string;
    };
    expect(ui.script).toBe(SCRIPT);
  });

  it("reaches the nodes that use the module, and survives resolution", () => {
    withScript();
    mkdirSync(join(dir, "nodes"), { recursive: true });
    writeFileSync(
      join(dir, "nodes", "hall.yaml"),
      'extends: "@workspace/audio/reverb"\n',
      "utf8",
    );
    const hall = loadModules(dir).hall;
    expect(resolvedUI(hall as never)?.script).toBe(SCRIPT);
  });

  it("is absent when the folder has none", () => {
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    writeUiFile(dir, "@workspace/audio/reverb", LCD);
    const ui = loadModuleRefs(dir)["@workspace/audio/reverb"].ui as object;
    expect("script" in ui).toBe(false);
  });

  it("is what an lcdscreen needs — it binds no param", () => {
    expect(UISchema.safeParse(LCD).success).toBe(true);
    const bound = {
      ...LCD,
      widgets: { screen: { ...LCD.widgets.screen, bind: "Mix" } },
    };
    expect(UISchema.safeParse(bound).success).toBe(false);
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
    writeSharedModule(INLINE);
    migrateModuleUis(dir);
    const panel = join(root, "_modules", "audio", "reverb", "ui.yaml");
    const before = readFileSync(panel, "utf8");
    const again = migrateModuleUis(dir);
    expect(again.moved).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(readFileSync(panel, "utf8")).toBe(before);
  });

  it("reports a ui it cannot move rather than dropping it", () => {
    writeSharedModule(
      "plugin:\n  name: Reverb\n  type: vst3\nui:\n  cols: 2\n",
    );
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(r.errors.join()).toMatch(/not a panel this can move/);
    // Still in the file, so nothing was lost.
    expect(
      readFileSync(
        join(root, "_modules", "audio", "reverb", "module.yaml"),
        "utf8",
      ),
    ).toMatch(/^ui:/m);
  });

  it("writes nothing when there is nothing inline", () => {
    writeSharedModule("plugin:\n  name: Reverb\n  type: vst3\n");
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(
      existsSync(join(root, "_modules", "audio", "reverb", "ui.yaml")),
    ).toBe(false);
  });
});

// A bare `widgets:` reads back as NULL, so the editor calls the file it just wrote malformed.
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
