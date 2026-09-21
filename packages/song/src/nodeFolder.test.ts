import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNode, loadModuleRefs, loadModules } from "./loader";
import { resolveModuleMap } from "./moduleResolve";
import { writeNode } from "./testSupport";

// The flat `nodes/` folder has no type path, so `kind`, `inputs` and `category` come from `extends`.

let ws: string;
let dir: string;

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-instfold-"));
  dir = join(ws, "song");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("the nodes folder", () => {
  it("loads each file as one use, keyed by its filename", () => {
    writeNode(dir, "lead", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { Input: -5 },
    });
    writeNode(dir, "rhythm", {
      plugin: { type: "internal", name: "Neural Amp Modeler" },
      params: { Input: 2 },
    });
    const m = loadModules(dir);
    // The FILE names it — no module folder is involved, so nothing else can.
    expect(Object.keys(m).sort()).toEqual(["lead", "rhythm"]);
    expect(m.lead.params).toEqual({ Input: -5 });
    expect(m.rhythm.params).toEqual({ Input: 2 });
  });

  it("carries the identity of the plugin, so the project stands on its own", () => {
    // The scan cache is machine-local, so the node has to say WHICH plugin itself.
    writeNode(dir, "slap", { plugin: { type: "internal", name: "ADT" } });
    expect(loadModules(dir).slap.plugin).toEqual({
      type: "internal",
      name: "ADT",
    });
  });

  it("takes kind, inputs and category from what it EXTENDS", () => {
    // The replacement for the type folder, and why a node need not sit under its module.
    mkdirSync(join(ws, "_modules", "instruments", "mini"), {
      recursive: true,
    });
    writeFileSync(
      join(ws, "_modules", "instruments", "mini", "module.yaml"),
      "plugin:\n  type: vst3\n  name: Mini V3\n",
      "utf8",
    );
    writeNode(dir, "solo", { extends: "@workspace/instruments/mini" });
    const resolved = resolveModuleMap(
      loadModules(dir),
      loadModuleRefs(dir, {}),
    );
    expect(resolved.solo).toMatchObject({
      kind: "plugin",
      category: "instruments",
      inputs: [{ name: "midi", type: "midi" }],
    });
    // …and the plugin comes down the same way.
    expect(resolved.solo.plugin).toEqual({ type: "vst3", name: "Mini V3" });
  });

  it("resolves an explicit library `extends` — that is how a shared module is used", () => {
    writeNode(dir, "gtr", { extends: "@library/audio/filter/auto-wah" });
    expect(loadModules(dir).gtr.extends).toBe("@library/audio/filter/auto-wah");
  });

  it("ignores a folder that holds nothing", () => {
    mkdirSync(join(dir, "nodes"), { recursive: true });
    expect(loadModules(dir)).toEqual({});
  });

  it("no longer reads a project's own modules/ at all — a module lives at @workspace or @st0 now", () => {
    mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "amp", "module.yaml"),
      "plugin:\n  type: internal\n  name: ADT\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "modules", "audio", "amp", "lead.yaml"),
      "params:\n  Input: -5\n",
      "utf8",
    );
    expect(loadModules(dir)).toEqual({});
  });
});

describe("creating one", () => {
  // One module, injected: the machine's own scan would decide this by what is installed.
  const CATALOGUE = {
    "@engine/adt": {
      plugin: { type: "internal", name: "ADT" },
      kind: "plugin" as const,
      inputs: [{ name: "in", type: "audio" as const }],
      category: "audio",
      file: "adt",
    },
  };

  it("writes the plugin into the node, with no module to inherit it from", () => {
    const rel = createNode(dir, "audio", "adt", "slap", CATALOGUE);
    expect(rel).toBe("nodes/slap.yaml");
    const m = loadModules(dir);
    // The identity lands in the FILE, so a machine that has never scanned still opens this song.
    expect(m.slap.plugin).toEqual({ type: "internal", name: "ADT" });
    expect(m.adt).toBeUndefined(); // and no module was invented on the way
  });

  it("refuses a name neither the project nor the engine has", () => {
    expect(() =>
      createNode(dir, "audio", "no-such-plugin", "x", CATALOGUE),
    ).toThrow(/neither in the workspace nor one the engine offers/);
  });
});
