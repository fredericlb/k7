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
import { formatChains } from "@studio/song-schema/yaml/graphFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModuleRefs } from "./loader";
import { materialiseEngineModule, sharedModuleRef } from "./moduleFork";
import { writeLibrary } from "./testSupport";
import { loadUiLibrary, writeUiFile } from "./uiLibrary";

// A shared module — `@workspace` or `@st0` — is edited in place; there is no project-local copy
// to fork a write into instead. What still forks is an ENGINE module, which has no file at all
// until `materialiseEngineModule` gives it one.

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
  // Two tracks through ONE module, so the fork must repoint a key AND every destination.
  writeFileSync(
    join(dir, "graph.yaml"),
    formatChains({
      modules: {
        "bs.lead": [SHARED],
        "dr.room": [SHARED],
        [SHARED]: ["OUT"],
      },
    }),
    "utf8",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const sharedFile = () =>
  join(root, "_modules", "audio", "delay", "tape-delay", "module.yaml");

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

// A scanned module has no files, so materialising makes the folder, records the plugin and repoints.
describe("giving an engine module a folder", () => {
  const NAM = "@engine/nam";
  // The catalogue is ambient, so it is injected exactly as loadModuleRefs takes its own.
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
      join(dir, "graph.yaml"),
      formatChains({
        modules: { "gt.lead": [NAM], [NAM]: ["OUT"] },
      }),
      "utf8",
    );
  });

  it("writes a module file that records WHICH plugin, and keys it locally", () => {
    // The scan is a discovery aid: on a machine that never scanned, the project still knows what to load.
    const r = materialiseEngineModule(dir, NAM, CATALOGUE);
    expect(r.module).toBe("nam");
    // Given a folder beside the project — an ordinary WORKSPACE module from here on.
    expect(r.path).toBe("../_modules/audio/nam/module.yaml");
    const text = readFileSync(join(dir, r.path), "utf8");
    expect(text).toContain("Neural Amp Modeler");
    expect(loadModuleRefs(dir)["@workspace/audio/nam"]?.plugin).toMatchObject(
      { name: "Neural Amp Modeler" },
    );
  });

  it("repoints the chains, so nothing still names the ref with no folder", () => {
    const r = materialiseEngineModule(dir, NAM, CATALOGUE);
    const after = readFileSync(join(dir, "graph.yaml"), "utf8");
    expect(after).not.toContain(NAM);
    expect(after).toContain("nam");
    expect(r.chains).toEqual(["gt.lead"]);
  });

  it("can then carry a panel, which is the whole point of the folder", () => {
    materialiseEngineModule(dir, NAM, CATALOGUE);
    writeUiFile(dir, "@workspace/audio/nam", {
      cols: 1,
      rows: 1,
      widgets: { g: { type: "knob", col: 0, row: 0, bind: "Gain" } },
    });
    expect(
      existsSync(join(root, "_modules", "audio", "nam", "ui.yaml")),
    ).toBe(true);
    expect(loadModuleRefs(dir)["@workspace/audio/nam"].ui).toBeTruthy();
  });

  it("steps past a name the workspace has taken rather than clobbering it", () => {
    mkdirSync(join(root, "_modules", "audio", "nam"), { recursive: true });
    writeFileSync(
      join(root, "_modules", "audio", "nam", "module.yaml"),
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
