import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@studio/k7x/document";
import { UISchema } from "@studio/song-schema/yaml/moduleSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs, loadModules } from "./loader";
import { resolvedUI } from "./moduleResolve";
import {
  setDoc,
  writeDoc,
  writeLibraries,
  writeLibrary,
  writeNode,
} from "./testSupport";
import { loadUiLibrary, uiFileText, uiPathFor, writeUiFile } from "./uiLibrary";
import { migrateModuleUis } from "./uiMigrate";
import { wsData, wsText } from "./yaml/workspaceDoc";

// A panel is the `ui.k7x` in the module's own FOLDER, which is the key: no `ref` can disagree with it.

const PANEL = {
  cols: 2,
  rows: 1,
  widgets: {
    mix: { type: "knob" as const, col: 0, row: 0, bind: "Mix", label: "Mix" },
  },
};
const REVERB = { plugin: { name: "Reverb", type: "vst3" } };

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-ui-"));
  writeLibrary(root);
  dir = join(root, "song");
  writeDoc(join(dir, "project.k7x"), { project: { name: "song", tempo: 120 } });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const reverbDir = (): string => join(root, "_modules", "audio", "reverb");

// A module at `@workspace`, spelled out rather than built by a production writer.
const writeSharedModule = (value: Record<string, unknown>): void =>
  writeDoc(join(reverbDir(), "module.k7x"), value);

describe("panels across more than one library", () => {
  // A SECOND library, answering to `@k7-core` by its folder and no config.
  let media: string;
  beforeEach(() => {
    media = writeLibraries(root);
  });

  it("loads a module OUT of the media library, through the @k7-core token", () => {
    // The project reaches a library it does not contain, with no path anywhere in project.k7x.
    const refs = loadModuleRefs(dir);
    expect(refs["@k7-core/audio/reverb"]).toBeTruthy();
    expect(refs["@workspace/audio/delay/tape-delay"]).toBeTruthy();
  });

  it("finds a panel beside a module in a declared library", () => {
    writeDoc(join(media, "modules", "audio", "reverb", "ui.k7x"), PANEL);
    expect(loadUiLibrary(dir).byRef["@k7-core/audio/reverb"]?.ui).toEqual(
      PANEL,
    );
  });

  it("writes a shared module's panel into the shared module's own folder", () => {
    // A panel is drawn for the plugin, so it lands where the plugin is, not in every project.
    const written = writeUiFile(dir, "@k7-core/audio/reverb", PANEL);
    expect(written).toBe(join(media, "modules", "audio", "reverb", "ui.k7x"));
    expect(loadUiLibrary(dir).byRef["@k7-core/audio/reverb"]?.ui).toEqual(
      PANEL,
    );
  });

  it("refuses a namespace no library this project can see declares", () => {
    // Guessing a root files the panel under a module that is not there: a save that draws nothing.
    expect(() => writeUiFile(dir, "@nowhere/audio/reverb", PANEL)).toThrow(
      /@nowhere/,
    );
  });

  it("keeps two modules of the same name apart, one per level", () => {
    // One NAME in two libraries is a fork, so both are keyed separately, nearest first.
    writeUiFile(dir, "@k7-core/audio/reverb", { ...PANEL, cols: 9 });
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const lib = loadUiLibrary(dir);
    expect(lib.byRef["@workspace/audio/reverb"].ui.cols).toBe(PANEL.cols);
    expect(lib.byRef["@k7-core/audio/reverb"].ui.cols).toBe(9);
    expect(lib.issues).toEqual([]);
  });
});

describe("where a panel files itself", () => {
  it("sits in the module's own folder, namespace dropped", () => {
    expect(uiPathFor("@workspace/audio/delay/tape-delay")).toBe(
      "audio/delay/tape-delay/ui.k7x",
    );
    expect(uiPathFor("audio/reverb")).toBe("audio/reverb/ui.k7x");
    // An io ref carries no type folder, so it gets one back from the REF's shape.
    expect(uiPathFor("desk")).toBe("io/desk/ui.k7x");
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
    writeDoc(join(root, "_modules", "audio", "broken", "ui.k7x"), {
      cols: "nope",
    });
    const lib = loadUiLibrary(dir);
    expect(lib.issues).toHaveLength(1);
    expect(lib.byRef["@workspace/audio/reverb"]).toBeTruthy();
  });

  // Which folders hold a panel is cached on the folders' NAMES, so it must move with them inside the settle window too.
  it("sees a panel added, edited and removed straight after a read", () => {
    const ref = "@workspace/audio/reverb";
    expect(loadUiLibrary(dir).byRef[ref]).toBeUndefined();
    const path = writeUiFile(dir, ref, PANEL);
    expect(loadUiLibrary(dir).byRef[ref]?.ui.cols).toBe(2);
    writeUiFile(dir, ref, { ...PANEL, cols: 3 });
    expect(loadUiLibrary(dir).byRef[ref]?.ui.cols).toBe(3);
    rmSync(path);
    expect(loadUiLibrary(dir).byRef[ref]).toBeUndefined();
  });

  it("ignores a panel under a dot folder, which the module stamp does not see", () => {
    writeDoc(join(root, "_modules", "audio", ".trash", "ui.k7x"), PANEL);
    expect(loadUiLibrary(dir).byRef["@workspace/audio/.trash"]).toBeUndefined();
  });

  it("never reads a panel under a YAML name", () => {
    writeSharedModule(REVERB);
    writeFileSync(
      join(reverbDir(), "ui.yaml"),
      "cols: 2\nrows: 1\nwidgets: {}\n",
    );
    expect(loadUiLibrary(dir).byRef["@workspace/audio/reverb"]).toBeUndefined();
  });

  it("is not read as a node of the module it sits beside", () => {
    // Every `<name>.k7x` in a module folder is a use, so an unguarded one reads as "reverb:ui".
    writeSharedModule(REVERB);
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
    writeDoc(join(root, "_modules", "io", "IN", "in-2.k7x"), { channel: [2] });
    writeUiFile(dir, "@workspace/io/IN", PANEL);
    const refs = loadModuleRefs(dir);
    expect(refs["@workspace/io/IN"].ui).toEqual(PANEL);
    expect(refs["@workspace/io/IN:in-2"].ui).toEqual(PANEL);
    // …and the node keeps what makes it one.
    expect(refs["@workspace/io/IN:in-2"].channel).toEqual([2]);
  });

  it("replaces an inline ui whole rather than merging into it", () => {
    writeSharedModule({
      ...REVERB,
      ui: {
        cols: 9,
        rows: 9,
        widgets: { old: { type: "knob", col: 0, row: 0, bind: "Old" } },
      },
    });
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    const ui = loadModuleRefs(dir)["@workspace/audio/reverb"]
      .ui as typeof PANEL;
    expect(ui.cols).toBe(2);
    expect(Object.keys(ui.widgets)).toEqual(["mix"]); // no trace of the module's own grid
  });

  it("shows a module's panel on the nodes that use it", () => {
    // A node has no ref of its own to be filed under, so it is looked up by what it extends.
    writeSharedModule(REVERB);
    writeNode(dir, "hall", {
      extends: "@workspace/audio/reverb",
      params: { Mix: 0.9 },
    });
    writeUiFile(dir, "@workspace/audio/reverb", PANEL);
    expect(loadModules(dir).hall.ui).toEqual(PANEL);
  });

  it("leaves modules alone when nothing has been drawn", () => {
    writeSharedModule(REVERB);
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
    writeSharedModule(REVERB);
    writeUiFile(dir, "@workspace/audio/reverb", LCD);
    writeFileSync(join(reverbDir(), "widgets.js"), SCRIPT, "utf8");
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
    writeNode(dir, "hall", { extends: "@workspace/audio/reverb" });
    const hall = loadModules(dir).hall;
    expect(resolvedUI(hall as never)?.script).toBe(SCRIPT);
  });

  it("is absent when the folder has none", () => {
    writeSharedModule(REVERB);
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
  const INLINE = `// A reverb.
plugin({ name: "Reverb", type: "vst3" })
ui({
  cols: 2,
  rows: 1,
  widgets: { mix: { type: "knob", col: 0, row: 0, bind: "Mix", label: "Mix" } },
})
params({ Mix: 0.4 }) // kept
`;
  const writeInline = (): void => {
    mkdirSync(reverbDir(), { recursive: true });
    writeFileSync(join(reverbDir(), "module.k7x"), INLINE);
  };

  it("moves a shared module's panel into the shared module's folder", () => {
    const shared = join(
      root,
      "_modules",
      "audio",
      "delay",
      "tape-delay",
      "module.k7x",
    );
    setDoc(shared, ["ui"], { cols: 1, rows: 1, widgets: {} });
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([
      "@workspace/audio/delay/tape-delay → _modules/audio/delay/tape-delay/ui.k7x",
    ]);
    expect(wsData(shared).ui).toBeUndefined();
  });

  it("keeps the rest of the module file, comments included", () => {
    writeInline();
    expect(migrateModuleUis(dir).moved).toHaveLength(1);
    const text = wsText(join(reverbDir(), "module.k7x"));
    expect(text).toContain("// A reverb.");
    expect(text).toContain("// kept");
    expect(wsData(join(reverbDir(), "module.k7x"))).toEqual({
      ...REVERB,
      params: { Mix: 0.4 },
    });
    expect(wsData(join(reverbDir(), "ui.k7x"))).toEqual(PANEL);
  });

  it("is safe to run twice", () => {
    writeInline();
    migrateModuleUis(dir);
    const panel = join(reverbDir(), "ui.k7x");
    const before = wsText(panel);
    const again = migrateModuleUis(dir);
    expect(again.moved).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(wsText(panel)).toBe(before);
  });

  it("reports a ui it cannot move rather than dropping it", () => {
    writeSharedModule({ ...REVERB, ui: { cols: 2 } });
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(r.errors.join()).toMatch(/not a panel this can move/);
    // Still in the file, so nothing was lost.
    expect(wsData(join(reverbDir(), "module.k7x")).ui).toEqual({ cols: 2 });
  });

  it("writes nothing when there is nothing inline", () => {
    writeSharedModule(REVERB);
    const r = migrateModuleUis(dir);
    expect(r.moved).toEqual([]);
    expect(existsSync(join(reverbDir(), "ui.k7x"))).toBe(false);
  });
});

describe("a panel file reads back as what was written", () => {
  const roundTrips = (ui: Parameters<typeof uiFileText>[0]) =>
    UISchema.safeParse(parse(uiFileText(ui))).success;

  it("survives with no widgets at all — the scaffold's own shape", () => {
    expect(roundTrips({ cols: 4, rows: 2, widgets: {} })).toBe(true);
  });

  it("survives with widgets", () => {
    expect(
      roundTrips({
        cols: 4,
        rows: 2,
        widgets: { gain: { type: "knob", col: 0, row: 0 } },
      }),
    ).toBe(true);
  });
});
