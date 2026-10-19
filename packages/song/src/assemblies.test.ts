// What an assembly is on disk, and what a project holding one gets back. The load-bearing half
// is the LAST describe: an assembly must change nothing about the chains, because it is a
// drawing. See docs/assemblies.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "@studio/k7x/print";
import {
  parseAssembly,
  parseAssemblyTemplate,
} from "@studio/song-schema/yaml/assemblyFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assemblyIssues,
  libraryAssemblies,
  projectAssemblies,
  resolveAssemblies,
} from "./assemblies";
import { loadGraph, validate } from "./graph";
import { librariesFixture, writeDoc, writeNode } from "./testSupport";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-asm-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const TEMPLATE = `label("Turntable")
outputs([
  name("mix").type("audio").node("fade"),
  name("cue").type("audio").node("cue"),
])
params({
  Level: { node: "level", param: "Gain" },
  Fade: { node: "fade", param: "Level" },
})
`;

const INSTANCE = `uses("@k7-core/turntable")
members({ level: "levelA", fade: "fadeA", cue: "cueA" })
`;

/** An instance of the turntable mapping `members`. */
const instanceOf = (members: Record<string, string>): string =>
  stringify({ uses: "@k7-core/turntable", members });

/** A workspace holding one library template and one project that uses it. */
function workspace(instance: string, template = TEMPLATE): string {
  const dir = join(root, "song.k7");
  const lib = join(librariesFixture(root), "assemblies", "turntable");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, "assembly.k7x"), template);
  writeDoc(join(lib, "graph.k7x"), { modules: { level: ["fade"] } });
  mkdirSync(join(dir, "assemblies"), { recursive: true });
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeDoc(join(dir, "project.k7x"), { project: { name: "song" } });
  writeFileSync(join(dir, "assemblies", "turntableA.k7x"), instance);
  return dir;
}

describe("the two files", () => {
  it("reads a template's plugs and promoted params", () => {
    const { value, issues } = parseAssemblyTemplate(TEMPLATE);
    expect(issues).toEqual([]);
    expect(value?.label).toBe("Turntable");
    expect(value?.outputs?.[0]).toEqual({
      name: "mix",
      type: "audio",
      node: "fade",
    });
    expect(value?.params?.Level).toEqual({ node: "level", param: "Gain" });
  });

  it("refuses two plugs called the same thing on one side", () => {
    const { issues } = parseAssemblyTemplate(
      'outputs([\n  name("mix").type("audio").node("a"),\n  name("mix").type("audio").node("b"),\n])\n',
    );
    expect(issues[0]?.message).toContain("two outputs are called 'mix'");
  });

  it("reads an instance's template ref and members", () => {
    const { value, issues } = parseAssembly(INSTANCE);
    expect(issues).toEqual([]);
    expect(value?.uses).toBe("@k7-core/turntable");
    expect(value?.members.fade).toBe("fadeA");
  });

  it("names an unknown key rather than ignoring it", () => {
    const { value, issues } = parseAssembly(`${INSTANCE}colour("red")\n`);
    expect(value).toBeNull();
    expect(issues.map((i) => i.path)).toContain("colour");
  });
});

describe("resolving one against its template", () => {
  it("turns every template name into this project's node name", () => {
    const a = resolveAssemblies(workspace(INSTANCE)).turntableA;
    expect(a.label).toBe("Turntable");
    expect(a.outputs.map((o) => [o.name, o.node])).toEqual([
      ["mix", "fadeA"],
      ["cue", "cueA"],
    ]);
    expect(a.params.Level).toEqual({ node: "levelA", param: "Gain" });
    expect(a.missing).toBeUndefined();
  });

  it("drops a plug whose member this instance does not map, and keeps the rest", () => {
    const a = resolveAssemblies(
      workspace(instanceOf({ fade: "fadeA" })),
    ).turntableA;
    expect(a.outputs.map((o) => o.name)).toEqual(["mix"]);
    expect(a.params.Fade).toEqual({ node: "fadeA", param: "Level" });
    expect(a.params.Level).toBeUndefined();
  });

  it("still yields the box when the template resolves to nothing", () => {
    const dir = workspace(INSTANCE);
    rmSync(join(root, ".studio-home"), { recursive: true, force: true });
    const a = resolveAssemblies(dir).turntableA;
    expect(a.missing).toBe(true);
    expect(a.label).toBe("turntableA");
    expect(a.members.fade).toBe("fadeA");
    expect(a.outputs).toEqual([]);
    // A WARNING and not an error: a new library is empty, and the project still opens.
    const issue = assemblyIssues(dir)[0];
    expect(issue.severity).toBe("warning");
    expect(issue.message).toContain("@k7-core/turntable");
  });

  it("lists what the library holds, by ref", () => {
    expect(libraryAssemblies(workspace(INSTANCE)).map((a) => a.ref)).toEqual([
      "@k7-core/turntable",
    ]);
  });

  it("reports a file that will not read and keeps the ones that do", () => {
    const dir = workspace(INSTANCE);
    writeFileSync(join(dir, "assemblies", "broken.k7x"), "uses([])\n");
    const { assemblies, diagnostics } = projectAssemblies(dir);
    expect(assemblies.map((a) => a.id)).toEqual(["turntableA"]);
    expect(diagnostics[0]?.file).toBe("assemblies/broken.k7x");
  });
});

/** A project whose graph is real, so `validate` has modules to check the members against. */
function wired(members: Record<string, string>): string {
  const dir = workspace(instanceOf(members));
  writeDoc(join(dir, "graph.k7x"), {
    modules: { levelA: ["fadeA"], fadeA: ["MIX"], MIX: ["OUT"] },
  });
  for (const n of ["levelA", "fadeA"])
    writeNode(dir, n, { plugin: { type: "jsdsp" }, params: { Gain: 0 } });
  return dir;
}

const SOUND = { level: "levelA", fade: "fadeA" };

describe("what validate() says about one", () => {
  it("says nothing about a sound one", () => {
    const g = loadGraph(wired(SOUND));
    expect(validate(g).filter((s) => s.includes("assembly"))).toEqual([]);
  });

  it("names a member the project has not got", () => {
    const g = loadGraph(wired({ level: "levelA", fade: "nowhere" }));
    expect(validate(g)).toContain(
      "assembly 'turntableA': member 'fade' names 'nowhere', which this project has not got",
    );
  });

  it("refuses a node claimed by two boxes", () => {
    const dir = wired(SOUND);
    writeFileSync(
      join(dir, "assemblies", "turntableB.k7x"),
      instanceOf({ fade: "fadeA" }),
    );
    expect(validate(loadGraph(dir))).toContain(
      "node 'fadeA': in two assemblies ('turntableA', 'turntableB')",
    );
  });

  it("refuses a box named after a node — one flat key space", () => {
    const dir = wired(SOUND);
    writeFileSync(join(dir, "assemblies", "fadeA.k7x"), instanceOf({}));
    expect(validate(loadGraph(dir))).toContain(
      "assembly 'fadeA': a node of this project is already called that",
    );
  });
});

describe("an assembly is a DRAWING", () => {
  it("changes not one thing about the chains", () => {
    const dir = wired(SOUND);
    const withBox = loadGraph(dir);
    rmSync(join(dir, "assemblies"), { recursive: true, force: true });
    const without = loadGraph(dir);
    expect(withBox.chains).toEqual(without.chains);
    expect(withBox.modules).toEqual(without.modules);
    expect(withBox.tracks).toEqual(without.tracks);
    expect(Object.keys(withBox.assemblies)).toEqual(["turntableA"]);
    expect(without.assemblies).toEqual({});
  });
});
