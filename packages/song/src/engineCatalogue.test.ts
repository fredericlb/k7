import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  engineModules,
  isPluginScanned,
  scannedPluginNames,
  scannedPlugins,
} from "./engineCatalogue";
import { engineModuleOf } from "./moduleTypes";

// The engine's plugin scan, read as a catalogue of modules — what replaces the folder of
// generated wrappers `module populate` used to write into `_modules`.
//
// The interesting part is not the parsing, it is the two DERIVATIONS a wrapper used to
// encode in its file and its path: which plugin to load (format + name), and which type
// folder it belongs in (which decides its ports). Getting either wrong is silent — the
// engine looks for a plugin that isn't there, or a synth is wired as an audio effect.

let dir: string;
let file: string;

const scan = (...plugins: unknown[]) =>
  writeFileSync(file, JSON.stringify({ entries: [{ plugins }] }), "utf8");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-scan-"));
  file = join(dir, "exts.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reading the scan", () => {
  it("keeps what the scan knows and drops what it can't identify", () => {
    scan(
      {
        name: "Serum",
        format: "VST3",
        manufacturer: "Xfer",
        role: "instrument",
        instrument: true,
      },
      { format: "VST3" }, // no name
      { name: "Nameless" }, // no format
    );
    expect(scannedPlugins(file)).toEqual([
      {
        name: "Serum",
        format: "VST3",
        manufacturer: "Xfer",
        role: "instrument",
        instrument: true,
        category: undefined,
      },
    ]);
  });

  it("reads an EMPTY cache as 'cannot say', not as 'nothing installed'", () => {
    // The distinction is load-bearing: a machine that has never scanned would otherwise
    // paint every plugin in every project as missing.
    expect(isPluginScanned("vst3", "Serum", join(dir, "nope.json"))).toBe(true);
    writeFileSync(file, "{ not json", "utf8");
    expect(scannedPlugins(file)).toEqual([]);
    expect(isPluginScanned("vst3", "Serum", file)).toBe(true);
  });

  it("judges only against a cache that has something in it", () => {
    scan({ name: "Serum", format: "VST3" });
    expect(isPluginScanned("vst3", "serum", file)).toBe(true); // both sides lowercased
    expect(isPluginScanned("vst3", "Massive", file)).toBe(false);
  });

  it("is stable across runs, whatever order the scan wrote", () => {
    scan(
      { name: "Zebra", format: "VST3" },
      { name: "ADT", format: "internal" },
    );
    expect(scannedPlugins(file).map((p) => p.name)).toEqual(["ADT", "Zebra"]);
    expect(scannedPluginNames(file)).toEqual({
      internal: ["ADT"],
      vst3: ["Zebra"],
    });
  });
});

describe("the catalogue of modules", () => {
  it("names a plugin by its slug, and loads it by FORMAT", () => {
    scan({
      name: "Neural Amp Modeler",
      format: "internal",
      role: "audioEffect",
    });
    const m = engineModules(file)["@engine/neural-amp-modeler"];
    expect(m.plugin).toEqual({ type: "internal", name: "Neural Amp Modeler" });
  });

  it("does NOT call a VST3 instrument a built-in", () => {
    // `module populate` wrote `type: internal` whenever the role was "instrument", which
    // mislabelled every VST3 synth: the engine would look for a built-in by that name.
    // Nothing hit it because the projects using those plugins declare them inline.
    scan({
      name: "Mini V3",
      format: "VST3",
      role: "instrument",
      instrument: true,
    });
    expect(engineModules(file)["@engine/mini-v3"].plugin).toEqual({
      type: "vst3",
      name: "Mini V3",
    });
  });

  it("names a plugin the same way a browser does", () => {
    // `engineModuleOf` is the shared rule, and this is what it exists to pin: the médiathèque
    // resolves `extends: "@engine/…"` in a BROWSER, against the scan reported over the socket,
    // having no filesystem to read this cache with. A different spelling there would preview a
    // plugin the compiled document never loads — silence, with a panel drawn over it.
    const p = { name: "Mini V3", format: "VST3" };
    scan({ ...p, role: "instrument", instrument: true });
    const named = engineModuleOf(p);
    expect(named).toEqual({
      ref: "@engine/mini-v3",
      plugin: { type: "vst3", name: "Mini V3" },
    });
    expect(engineModules(file)[named?.ref ?? ""].plugin).toEqual(named?.plugin);
  });

  it("files a plugin by ROLE, which is what decides its ports", () => {
    scan(
      { name: "Mini V3", format: "VST3", role: "instrument", instrument: true },
      { name: "ADT", format: "internal", role: "audioEffect" },
      { name: "Arp", format: "internal", role: "midiEffect" },
    );
    const m = engineModules(file);
    // An instrument takes midi and gives audio; an audio effect takes audio; a midi
    // effect takes midi and gives midi back. Wire one as the other and the chain's port
    // check passes on a lie.
    expect(m["@engine/mini-v3"].category).toBe("instruments");
    expect(m["@engine/mini-v3"].inputs).toEqual([
      { name: "midi", type: "midi" },
    ]);
    expect(m["@engine/adt"].category).toBe("audio");
    expect(m["@engine/adt"].inputs).toEqual([{ name: "in", type: "audio" }]);
    expect(m["@engine/arp"].category).toBe("transformers");
  });

  it("offers the io modules even with no scan at all", () => {
    // They are not plugins — the engine provides them, and a project that has never
    // scanned still has to be able to route to its output.
    const m = engineModules(join(dir, "nope.json"));
    expect(Object.keys(m)).toEqual([
      "@engine/IN",
      "@engine/OUT",
      "@engine/FILE",
    ]);
    expect(m["@engine/IN"]).toMatchObject({
      io: "in",
      kind: "io",
      category: "io",
    });
    expect(m["@engine/OUT"]).toMatchObject({ io: "out", kind: "io" });
    // The file source: audio off disk, and a SOURCE like IN rather than a sink. Which file it
    // reads is a node's business, and a chain template's node names none.
    expect(m["@engine/FILE"]).toMatchObject({
      io: "file",
      kind: "io",
      category: "io",
    });
  });

  it("collapses two scans of one plugin into one module", () => {
    scan(
      { name: "Chorus", format: "internal" },
      { name: "Chorus", format: "internal" },
    );
    const refs = Object.keys(engineModules(file)).filter((r) =>
      r.includes("chorus"),
    );
    expect(refs).toEqual(["@engine/chorus"]);
  });
});
