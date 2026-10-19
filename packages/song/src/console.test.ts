// A summing CONSOLE: `project.console` names a system, and the compile places its two halves.
// Pinned here: the channel lands right after the strip, the buss first on the master, a lane
// leaving by CUE and a bus return get none, and a system that is not there stops the compile.
// See docs/console.md.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc, pluginDoc, trackDoc } from "@studio/engine-protocol/build";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consoleSystems, withConsole } from "./console";
import { baseModuleRefs, loadModuleRefs } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { writeDoc, writeLibraries, writeLibrary } from "./testSupport";

const SYS = "@k7-core/console/console-6";
let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-console-"));
  writeLibrary(root);
  dir = join(root, "song");
  mkdirSync(dir, { recursive: true });
  writeDoc(join(dir, "project.k7x"), { project: { name: "s" } });
  writeLibraries(root, {
    "console/console-6/channel": {
      plugin: { type: "internal", name: "Console 6 Channel" },
    },
    "console/console-6/buss": {
      plugin: { type: "internal", name: "Console 6 Buss" },
    },
    // Half a system is no system: a picker must not offer it.
    "console/broken/channel": { plugin: { type: "internal", name: "X" } },
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const doc = () =>
  emptyDoc({
    tracks: [
      trackDoc("gtr", {
        plugins: [
          pluginDoc({ id: "gtr:amp", type: "Amp" }),
          pluginDoc({ id: "gtr:mix", type: "Mixer" }),
          pluginDoc({ id: "gtr:after", type: "Meter" }),
        ],
      }),
      trackDoc("raw", {}),
      trackDoc("cue", { outputChannels: [3, 4] }),
      trackDoc("verb", { role: "effect" }),
    ],
    masterPlugins: [pluginDoc({ id: "MIX:comp", type: "Compressor" })],
  });

describe("the systems", () => {
  it("lists a system only when it has both halves, named by its folder", () => {
    expect(consoleSystems(loadModuleRefs(dir))).toEqual([
      { ref: SYS, label: "console-6" },
    ]);
  });

  it("never offers a half as a module of its own", () => {
    expect(
      baseModuleRefs(loadModuleRefs(dir)).filter((r) =>
        r.includes("/console/"),
      ),
    ).toEqual([]);
  });
});

describe("placing the halves", () => {
  it("puts the channel right after the strip, and at the end of a lane with none", () => {
    const out = withConsole(doc(), SYS, loadModuleRefs(dir));
    const ids = (id: string) =>
      out.tracks.find((t) => t.id === id)?.plugins.map((p) => p.id);
    expect(ids("gtr")).toEqual([
      "gtr:amp",
      "gtr:mix",
      "@console:gtr",
      "gtr:after",
    ]);
    expect(ids("raw")).toEqual(["@console:raw"]);
  });

  it("leaves a lane leaving by CUE and a bus return alone", () => {
    const out = withConsole(doc(), SYS, loadModuleRefs(dir));
    for (const id of ["cue", "verb"])
      expect(out.tracks.find((t) => t.id === id)?.plugins).toEqual([]);
  });

  it("puts the buss FIRST on the master", () => {
    const out = withConsole(doc(), SYS, loadModuleRefs(dir));
    expect(out.masterPlugins.map((p) => [p.id, p.type])).toEqual([
      ["@console:master", "Console 6 Buss"],
      ["MIX:comp", "Compressor"],
    ]);
  });

  it("changes nothing without a console", () => {
    const before = doc();
    expect(withConsole(before, undefined, loadModuleRefs(dir))).toBe(before);
  });

  it("stops the compile on a system with a half missing, saying which", () => {
    expect(() =>
      withConsole(doc(), "@k7-core/console/broken", loadModuleRefs(dir)),
    ).toThrow(/project\.console '@k7-core\/console\/broken': no buss module/);
  });

  it("is read off project.k7x by the compile itself", () => {
    writeDoc(join(dir, "project.k7x"), {
      project: { name: "s", console: SYS },
    });
    expect(compileNodeProject(dir).masterPlugins[0]?.id).toBe(
      "@console:master",
    );
  });
});
