// The three assembly verbs, and the two writes that keep a box's member list honest when a node
// underneath it is renamed or deleted. What `new` has to get right is that instancing lands an
// ORDINARY graph: renamed nodes, renamed wiring, and one record beside it.
// See packages/song/docs/assemblies.md.

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
import { librariesFixture } from "@studio/song/testSupport";
import { parseAssembly } from "@studio/song-schema/yaml/assemblyFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let root: string;
let dir: string;
const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

const graph = () => readFileSync(join(dir, "graph.yaml"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "asm-verb-"));
  dir = join(root, "song.st0");
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(join(dir, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(dir, "graph.yaml"), "modules:\n  MIX: [ OUT ]\n", "utf8");
  // A template in the library: two members, wired, one of them bypassed.
  const lib = join(librariesFixture(root), "assemblies", "turntable");
  mkdirSync(join(lib, "nodes"), { recursive: true });
  writeFileSync(
    join(lib, "assembly.yaml"),
    "label: Turntable\noutputs:\n  - { name: mix, type: audio, node: fade }\n",
    "utf8",
  );
  writeFileSync(
    join(lib, "graph.yaml"),
    "modules:\n  deck: [ fade ]\n  fade: [ MIX ]\nbypassed: [ deck ]\n",
    "utf8",
  );
  for (const n of ["deck", "fade"])
    writeFileSync(
      join(lib, "nodes", `${n}.yaml`),
      `extends: "@st0/audio/utility/${n}"\n`,
      "utf8",
    );
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("assembly new", () => {
  it("copies the members in under the box's name, and their wiring with them", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    expect(existsSync(join(dir, "nodes", "turntableA_deck.yaml"))).toBe(true);
    expect(
      readFileSync(join(dir, "nodes", "turntableA_fade.yaml"), "utf8"),
    ).toContain("@st0/audio/utility/fade");
    const g = graph();
    expect(g).toContain("turntableA_deck: [ turntableA_fade ]");
    // A destination the template does not own is copied verbatim — that is where its signal leaves to.
    expect(g).toContain("turntableA_fade: [ MIX ]");
    expect(g).toContain("bypassed: [ turntableA_deck ]");
    // …and the graph it was written into is untouched.
    expect(g).toContain("MIX: [ OUT ]");
  });

  it("writes the record, mapping the template's names to this project's", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    const a = parseAssembly(
      readFileSync(join(dir, "assemblies", "turntableA.yaml"), "utf8"),
    ).value;
    expect(a?.uses).toBe("@st0/turntable");
    expect(a?.members).toEqual({
      deck: "turntableA_deck",
      fade: "turntableA_fade",
    });
  });

  it("pins the box under its own name when the click sent one", async () => {
    await runCommand(
      "assembly new @st0/turntable turntableA 120,40",
      host(),
      "cli",
    );
    expect(graph()).toMatch(/turntableA: \{ x: 120, y: 40 \}/);
  });

  it("refuses a template no library holds, and writes nothing", async () => {
    await runCommand("assembly new @st0/nope turntableA", host(), "cli");
    expect(logs.join(" ")).toContain("no assembly template '@st0/nope'");
    expect(existsSync(join(dir, "assemblies"))).toBe(false);
  });

  it("refuses a second box of the same name", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    logs.length = 0;
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    expect(logs.join(" ")).toContain("already exists");
  });
});

describe("graph move, on a box", () => {
  it("pins it under its own name, though it is no key of `modules:`", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    logs.length = 0;
    await runCommand("graph move turntableA 200 80", host(), "cli");
    expect(logs.join(" ")).toContain("turntableA: pinned at 200,80");
    expect(graph()).toMatch(/turntableA: { x: 200, y: 80 }/);
  });

  it("hands it back to the layout", async () => {
    await runCommand(
      "assembly new @st0/turntable turntableA 10,10",
      host(),
      "cli",
    );
    await runCommand("graph move turntableA auto", host(), "cli");
    expect(graph()).not.toContain("turntableA: {");
  });

  it("still names a box this project has not got, and lists the ones it has", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    logs.length = 0;
    await runCommand("graph move turntableZ 1 1", host(), "cli");
    const said = logs.join(" ");
    expect(said).toContain('no node "turntableZ"');
    expect(said).toContain("assemblies: turntableA");
  });
});

describe("assembly dissolve", () => {
  it("drops the record and leaves every node exactly as it was", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    const before = graph();
    logs.length = 0;
    await runCommand("assembly dissolve turntableA", host(), "cli");
    expect(existsSync(join(dir, "assemblies", "turntableA.yaml"))).toBe(false);
    expect(graph()).toBe(before);
    expect(existsSync(join(dir, "nodes", "turntableA_deck.yaml"))).toBe(true);
  });
});

describe("assembly delete", () => {
  it("takes the record AND every node it held", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    logs.length = 0;
    await runCommand("assembly delete turntableA", host(), "cli");
    expect(existsSync(join(dir, "assemblies", "turntableA.yaml"))).toBe(false);
    expect(existsSync(join(dir, "nodes", "turntableA_deck.yaml"))).toBe(false);
    expect(existsSync(join(dir, "nodes", "turntableA_fade.yaml"))).toBe(false);
    expect(graph()).not.toContain("turntableA_");
  });

  it("names a box this project has not got", async () => {
    await runCommand("assembly delete nope", host(), "cli");
    expect(logs.join(" ")).toContain("no assembly 'nope'");
  });
});

describe("a node underneath a box", () => {
  it("takes its box's member entry with it when it is deleted", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    await runCommand("node delete turntableA_deck", host(), "cli");
    const a = parseAssembly(
      readFileSync(join(dir, "assemblies", "turntableA.yaml"), "utf8"),
    ).value;
    expect(a?.members).toEqual({ fade: "turntableA_fade" });
  });

  it("and the record goes with the LAST member — a box about nothing is not a box", async () => {
    await runCommand("assembly new @st0/turntable turntableA", host(), "cli");
    await runCommand("node delete turntableA_deck", host(), "cli");
    await runCommand("node delete turntableA_fade", host(), "cli");
    expect(existsSync(join(dir, "assemblies", "turntableA.yaml"))).toBe(false);
  });
});
