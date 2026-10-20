import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineModuleOf } from "@studio/song-schema/moduleTypes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  engineModules,
  ioModules,
  isPluginScanned,
  scannedPluginNames,
  scannedPlugins,
  writeScanCopy,
} from "./engineCatalogue";

// The scan read as a catalogue: what to LOAD and which type FOLDER, both silent when wrong.

describe("an account's copy of the scan", () => {
  it("is written in the scan's own shape, and read back", () => {
    const plugins = [{ name: "Serum", format: "VST3", role: "instrument" }];
    expect(writeScanCopy(plugins, file)).toBe(true);
    expect(scannedPlugins(file).map((p) => p.name)).toEqual(["Serum"]);
  });

  // Its mtime is in every project's revision token: a copy saying the same must not be touched.
  it("is left alone when it already says the same", () => {
    const plugins = [{ name: "Diva", format: "VST3" }];
    writeScanCopy(plugins, file);
    expect(writeScanCopy(plugins, file)).toBe(false);
  });
});

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
    // Otherwise a machine that has never scanned paints every plugin in every project missing.
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
    // `module populate` wrote `type: internal` for every instrument, mislabelling VST3 synths.
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
    // The browser resolves `@engine/…` off the socket, and a different spelling previews silence.
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
    // Wire an instrument as an effect and the chain's port check passes on a lie.
    expect(m["@engine/mini-v3"].category).toBe("instruments");
    expect(m["@engine/mini-v3"].inputs).toEqual([
      { name: "midi", type: "midi" },
    ]);
    expect(m["@engine/adt"].category).toBe("audio");
    expect(m["@engine/adt"].inputs).toEqual([{ name: "in", type: "audio" }]);
    expect(m["@engine/arp"].category).toBe("transformers");
  });

  it("offers the io modules even with no scan at all", () => {
    // Built into the app, not scanned, so an unscanned project still has to reach its output.
    const m = ioModules();
    expect(Object.keys(m)).toEqual([
      "@meta/IN",
      "@meta/OUT",
      // The lens, which the BROWSER opens rather than the engine — packages/song/docs/camera.md.
      "@meta/CAM",
      "@meta/CUE",
      "@meta/FILE",
      // …and a MIDI device, which the BROWSER records from — packages/song/docs/midiIn.md.
      "@meta/MIDI",
    ]);
    expect(m["@meta/IN"]).toMatchObject({
      io: "in",
      kind: "io",
      category: "io",
    });
    expect(m["@meta/OUT"]).toMatchObject({ io: "out", kind: "io" });
    // The file source: audio off disk, and a SOURCE like IN rather than a sink.
    expect(m["@meta/FILE"]).toMatchObject({
      io: "file",
      kind: "io",
      category: "io",
    });
  });

  it("engineModules() itself offers no io roles, scanned or not", () => {
    expect(
      Object.keys(engineModules(join(dir, "nope.json"))).filter((r) =>
        r.startsWith("@meta/"),
      ),
    ).toEqual([]);
  });

  it("offers the built-ins while no scan can say, so a fresh machine compiles a Surge node", () => {
    // A fresh account's file service has no exts.json until an engine is bound; dropping @engine/surge-xt then sent no patch.
    for (const empty of [join(dir, "nope.json"), file]) {
      if (empty === file) scan();
      const m = engineModules(empty);
      expect(m["@engine/surge-xt"]).toMatchObject({
        plugin: { type: "internal", name: "Surge XT" },
        category: "instruments",
      });
      expect(m["@engine/adt"]?.category).toBe("audio");
      expect(m["@engine/arpeggiator"]?.category).toBe("transformers");
    }
  });

  it("lets a scan that says something replace the built-in table", () => {
    // A scan is what THIS engine has: a build without Surge must not be sent one.
    scan({ name: "4OSC", format: "internal", role: "instrument" });
    expect(Object.keys(engineModules(file))).toEqual(["@engine/4osc"]);
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
