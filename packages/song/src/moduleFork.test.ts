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
import { loadModules } from "./loader";
import {
  forkSharedModule,
  materialiseEngineModule,
  sharedModuleRef,
} from "./moduleFork";
import { writeLibrary } from "./testSupport";
import { loadUiLibrary, writeUiFile } from "./uiLibrary";
import { formatChains } from "./yaml/chainsFile";

// Editing a module that lives in the workspace's SHARED `_modules` must never write there — one library backs
// every project, so a save made while mixing one song would change the others. The edit is copied into the
// project instead and the chains follow it. What has to hold:
//
//   * the shared file is byte-for-byte what it was;
//   * the edit is readable through the project's own module map, UI included;
//   * every chain that named the shared ref names the copy — none still points at the original;
//   * a second fork is a second module, not a collision with the first.

let root: string; // the workspace: _modules/ beside the project
let dir: string; // the project

const SHARED = "@workspace/audio/delay/tape-delay";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-fork-"));
  writeLibrary(root);
  dir = join(root, "song");
  mkdirSync(join(dir, "modules"), { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: song\n  tempo: 120\n  modules_from:\n    - ../_modules\n",
    "utf8",
  );
  // Two tracks through ONE shared module — so the fork has to repoint a key AND every
  // destination naming it, which is the whole point of the repointing test below.
  writeFileSync(
    join(dir, "chains.yaml"),
    formatChains({
      tracks: { "bs.lead": [SHARED], "dr.room": [SHARED] },
      modules: { [SHARED]: ["OUT"] },
    }),
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const sharedFile = () =>
  join(root, "_modules", "audio", "delay", "tape-delay", "module.yaml");

const EDIT = "plugin:\n  name: Tape Delay\n  type: vst3\nparams:\n  Mix: 0.8\n";

describe("locating a shared module", () => {
  it("keys a file the way readModuleTree keys the module", () => {
    expect(sharedModuleRef(dir, sharedFile())?.ref).toBe(
      "@workspace/audio/delay/tape-delay",
    );
    // …and one that skips the category folder, which populate writes for uncategorised plugins.
    expect(
      sharedModuleRef(
        dir,
        join(root, "_modules", "instruments", "4osc", "module.yaml"),
      )?.ref,
    ).toBe("@workspace/instruments/4osc");
  });

  it("is null for a file outside the libraries this project inherits", () => {
    expect(
      sharedModuleRef(dir, join(dir, "modules", "audio", "x", "module.yaml")),
    ).toBeNull();
  });
});

describe("forking on edit", () => {
  it("leaves the shared module exactly as it was", () => {
    const before = readFileSync(sharedFile(), "utf8");
    forkSharedModule(dir, sharedFile(), EDIT);
    expect(readFileSync(sharedFile(), "utf8")).toBe(before);
  });

  it("names the copy after the track that plays it", () => {
    const r = forkSharedModule(dir, sharedFile(), EDIT);
    // "bs.lead" is not a legal module segment; the dot becomes an underscore rather than an error.
    expect(r.module).toBe("bs_lead_tape-delay_1");
    expect(r.path).toBe("modules/audio/bs_lead_tape-delay_1/module.yaml");
    expect(readFileSync(join(dir, r.path), "utf8")).toBe(EDIT);
  });

  it("copies the whole folder, so the module still resolves against its own files", () => {
    writeFileSync(
      join(root, "_modules", "audio", "delay", "tape-delay", "dsp.ts"),
      "// dsp\n",
    );
    const r = forkSharedModule(dir, sharedFile(), EDIT);
    expect(existsSync(join(dir, "modules", "audio", r.module, "dsp.ts"))).toBe(
      true,
    );
  });

  it("repoints every node that named the shared ref, and leaves none behind", () => {
    const r = forkSharedModule(dir, sharedFile(), EDIT);
    expect(r.chains).toEqual(["bs.lead", "dr.room"]);
    const text = readFileSync(join(dir, "chains.yaml"), "utf8");
    expect(text).not.toContain("@workspace/audio/delay/tape-delay");
    // Three times: the two tracks that feed it, and its own entry. Missing the key would
    // leave the module unwired; missing a destination would leave a dangling reference.
    expect(text.match(/bs_lead_tape-delay_1/g)).toHaveLength(3);
    // …and unquoted now: the shared ref needed quotes for its leading @, this name does not.
    expect(text).not.toContain('"bs_lead_tape-delay_1"');
  });

  it("makes the edit readable as a module of this project", () => {
    const r = forkSharedModule(dir, sharedFile(), EDIT);
    const m = loadModules(dir, true)[r.module];
    expect(m).toBeTruthy();
    expect(m.params?.Mix).toBe(0.8);
  });

  it("carries a UI edit, which is most of what the module editor does", () => {
    const r = forkSharedModule(
      dir,
      sharedFile(),
      [
        "plugin:",
        "  name: Tape Delay",
        "  type: vst3",
        "ui:",
        "  cols: 4",
        "  rows: 1",
        "  widgets:",
        "    w1:",
        "      type: knob",
        "      col: 0",
        "      row: 0",
        "      label: Mine",
        "",
      ].join("\n"),
    );
    const ui = loadModules(dir, true)[r.module].ui as {
      widgets: Record<string, { label?: string }>;
    };
    expect(ui.widgets.w1.label).toBe("Mine");
  });

  it("gives a second fork its own module rather than colliding", () => {
    const first = forkSharedModule(dir, sharedFile(), EDIT);
    // The first fork repointed everything, so re-wire a track onto the shared module.
    writeFileSync(
      join(dir, "chains.yaml"),
      formatChains({
        tracks: { "bs.lead": [SHARED] },
        modules: { [SHARED]: ["OUT"] },
      }),
      "utf8",
    );
    const second = forkSharedModule(dir, sharedFile(), EDIT);
    expect(first.module).toBe("bs_lead_tape-delay_1");
    expect(second.module).toBe("bs_lead_tape-delay_2");
  });

  it("still forks a module no chain plays yet, rather than dropping the edit", () => {
    const file = join(root, "_modules", "instruments", "4osc", "module.yaml");
    const r = forkSharedModule(
      dir,
      file,
      "plugin:\n  name: 4OSC\n  type: internal\n",
    );
    expect(r.module).toBe("4osc_1");
    expect(r.chains).toEqual([]);
    expect(existsSync(join(dir, r.path))).toBe(true);
  });

  it("carries the shared module's panel over to the copy", () => {
    // The panel is a file in the module's folder, so the folder copy brings it — and the header it is rewritten
    // with names the copy. Without either the fork would come up blank, which reads as the edit having wiped
    // the module's face.
    const panel = {
      cols: 2,
      rows: 1,
      widgets: {
        mix: {
          type: "knob" as const,
          col: 0,
          row: 0,
          bind: "Mix",
          label: "Mix",
        },
      },
    };
    writeUiFile(dir, "@workspace/audio/delay/tape-delay", panel);
    const r = forkSharedModule(dir, sharedFile(), EDIT);
    expect(loadUiLibrary(dir).byRef[`audio/${r.module}`]?.ui).toEqual(panel);
    expect(loadModules(dir, true)[r.module].ui).toEqual(panel);
    // …and the shared panel is untouched, for whoever still uses the shared module.
    expect(
      loadUiLibrary(dir).byRef["@workspace/audio/delay/tape-delay"].ui,
    ).toEqual(panel);
  });

  it("refuses a sidecar, which would fork into a folder no chain names", () => {
    const side = join(
      root,
      "_modules",
      "audio",
      "delay",
      "tape-delay",
      "dsp.ts",
    );
    writeFileSync(side, "// dsp\n", "utf8");
    expect(() => forkSharedModule(dir, side, "// edited\n")).toThrow(
      /read-only/,
    );
  });
});

// A module the ENGINE reports has no files anywhere — the catalogue is synthesised from the scan cache. That
// is fine until you want to give it a face or a shelf, because both are files in a module's FOLDER. What
// materialising has to do: make the folder, record which plugin to load, and take the chains with it.
describe("giving an engine module a folder", () => {
  const NAM = "@engine/nam";
  // The catalogue is ambient — what this machine happens to have scanned — so it is injected, exactly as
  // loadModuleRefs and createModuleInstance take theirs.
  const CATALOGUE = {
    [NAM]: {
      plugin: { type: "vst3", name: "Neural Amp Modeler" },
      kind: "plugin",
      inputs: [],
      category: "audio",
      file: "nam",
    },
  } as unknown as Parameters<typeof materialiseEngineModule>[2];

  beforeEach(() => {
    writeFileSync(
      join(dir, "chains.yaml"),
      formatChains({
        tracks: { "gt.lead": [NAM] },
        modules: { [NAM]: ["OUT"] },
      }),
      "utf8",
    );
  });

  it("writes a module file that records WHICH plugin, and keys it locally", () => {
    // The scan is a discovery aid, not the project's memory: opened on a machine that has never scanned, the
    // project must still know what to load.
    const r = materialiseEngineModule(dir, NAM, CATALOGUE);
    expect(r.module).toBe("nam");
    expect(r.path).toBe("modules/audio/nam/module.yaml");
    const text = readFileSync(join(dir, r.path), "utf8");
    expect(text).toContain("Neural Amp Modeler");
    expect(loadModules(dir).nam?.plugin).toMatchObject({
      name: "Neural Amp Modeler",
    });
  });

  it("repoints the chains, so nothing still names the ref with no folder", () => {
    const r = materialiseEngineModule(dir, NAM, CATALOGUE);
    const after = readFileSync(join(dir, "chains.yaml"), "utf8");
    expect(after).not.toContain(NAM);
    expect(after).toContain("nam");
    expect(r.chains).toEqual(["gt.lead"]);
  });

  it("can then carry a panel, which is the whole point of the folder", () => {
    materialiseEngineModule(dir, NAM, CATALOGUE);
    writeUiFile(dir, "audio/nam", {
      cols: 1,
      rows: 1,
      widgets: { g: { type: "knob", col: 0, row: 0, bind: "Gain" } },
    });
    expect(existsSync(join(dir, "modules", "audio", "nam", "ui.yaml"))).toBe(
      true,
    );
    expect(loadModules(dir).nam.ui).toBeTruthy();
  });

  it("steps past a name the project has taken rather than clobbering it", () => {
    mkdirSync(join(dir, "modules", "audio", "nam"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "nam", "module.yaml"),
      "plugin:\n  name: Something Else\n  type: vst3\n",
      "utf8",
    );
    expect(materialiseEngineModule(dir, NAM, CATALOGUE).module).toBe("nam_2");
  });

  it("refuses a ref the engine doesn't offer, rather than making an empty folder", () => {
    expect(() =>
      materialiseEngineModule(dir, "@engine/nope", CATALOGUE),
    ).toThrow(/not a module this machine's engine offers/);
  });
});
