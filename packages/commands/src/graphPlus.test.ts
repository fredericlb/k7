// What the graph's `+` and its right-click end up writing: `node new` and `node insert`.
//
// Both take a node that EXISTS — one drops it in the graph wired to NOTHING, the other splices
// it into an arrow — and neither creates anything: creating is `module new`'s
// (packages/song/docs/nodes.md), so the picker writes two lines and these are the second.
//
// The failure worth guarding against is still the quiet one: naming in graph.yaml something
// that has no file, which is exactly what the compiler refuses to load.

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
import { runCommand } from "./commandSpec";

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

const chains = () => readFileSync(join(dir, "graph.yaml"), "utf8");
/** The picker's two lines: `module new` makes no node, so this is two commands. */
const make = async (target: string, node: string) => {
  await runCommand(`module new ${target}`, host(), "cli");
  await runCommand(`node new ${target} ${node}`, host(), "cli");
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-place-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "graph.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(dir, "nodes"), { recursive: true });
  writeFileSync(
    join(dir, "nodes", "gtr.yaml"),
    'extends: "@studio/track"\nevents: []\n',
    "utf8",
  );
  mkdirSync(join(dir, "modules", "audio", "amp"), { recursive: true });
  writeFileSync(
    join(dir, "modules", "audio", "amp", "module.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("module new — the creating half", () => {
  it("writes the MODULE and nothing else — no node, no chain", async () => {
    const before = chains();
    await runCommand("module new audio/wah", host(), "cli");
    expect(
      existsSync(join(dir, "modules", "audio", "wah", "module.yaml")),
    ).toBe(true);
    // A module is not a use of one. `node new` makes those, and it is what a chain names.
    expect(existsSync(join(dir, "nodes", "wah.yaml"))).toBe(false);
    expect(chains()).toBe(before);
  });

  it("says so when the module is already there, rather than refusing", async () => {
    // Picking the same module twice writes nothing, and that is ordinary rather than an error.
    await runCommand("module new audio/amp", host(), "cli");
    expect(logs.join(" ")).not.toMatch(/failed/);
    expect(logs.join(" ")).toMatch(/already here/);
  });

  it("refuses an extends-ref that disagrees with what it already extends", async () => {
    await runCommand(
      "module new audio/amp @engine/audio/reverb/hall",
      host(),
      "cli",
    );
    // audio/amp has no `extends` in this fixture, so nothing disagrees — it passes.
    expect(logs.join(" ")).not.toMatch(/failed/);
  });

  it("changes nothing when the target is not <category>/<name>", async () => {
    const before = chains();
    await runCommand("module new wah", host(), "cli");
    expect(logs.join(" ")).toMatch(/is not <category>\/<name>/);
    expect(chains()).toBe(before);
  });
});

describe("node new — in the graph, wired to nothing", () => {
  it("puts the node in the graph wired to nothing, disturbing no run", async () => {
    await make("audio/wah", "w1");
    expect(chains()).toContain("w1: []");
    // …and it touched nothing that was already wired.
    expect(chains()).toContain("gtr: [ amp ]");
    expect(chains()).toContain("amp: [ OUT ]");
  });

  it("puts one nobody placed above the origin rather than wherever the layout would", async () => {
    await make("audio/wah", "w1");
    expect(chains()).toContain("w1: { x: 0, y: -30 }");
  });

  it("…and where the cursor was when there was one, negative Y included", async () => {
    await runCommand("module new audio/wah", host(), "cli");
    await runCommand("node new audio/wah w1 -40,-120", host(), "cli");
    expect(chains()).toContain("w1: { x: -40, y: -120 }");
  });
});

describe("node insert", () => {
  it("splices an existing node into the arrow", async () => {
    await make("audio/gate", "g1");
    await runCommand("node insert gtr amp g1", host(), "cli");
    expect(chains()).toContain("gtr: [ g1 ]");
    expect(chains()).toContain("g1: [ amp ]");
    expect(chains()).toContain("amp: [ OUT ]");
  });

  it("refuses when the two ends aren't an arrow, and writes nothing", async () => {
    await make("audio/gate", "g1");
    const before = chains();
    await runCommand("node insert gtr OUT g1", host(), "cli");
    expect(logs.join(" ")).toMatch(/does not feed 'OUT'/);
    expect(chains()).toBe(before);
  });

  it("refuses a node nothing answers to", async () => {
    const before = chains();
    await runCommand("node insert gtr amp nope", host(), "cli");
    expect(logs.join(" ")).toMatch(/no node "nope"/);
    expect(chains()).toBe(before);
  });

  it("lands halfway along the cable when no cursor said where", async () => {
    // The drawing writes its own pins down (`graph pin`), so by the time anything is spliced the two ends have them.
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\npositions:\n  gtr: { x: 100, y: 40 }\n  amp: { x: 500, y: 140 }\n",
      "utf8",
    );
    await make("audio/gate", "g1");
    await runCommand("node insert gtr amp g1", host(), "cli");
    expect(chains()).toContain("g1: { x: 300, y: 90 }");
  });

  it("keeps the pin it was born with when the two ends have none", async () => {
    // Nothing to be halfway BETWEEN — a graph.yaml no drawing has ever pinned, which is a CLI-only project.
    await make("audio/gate", "g1");
    await runCommand("node insert gtr amp g1", host(), "cli");
    expect(chains()).toContain("g1: { x: 0, y: -30 }");
  });
});

// The master run is the arrow `MIX: [ OUT ]` — packages/song/docs/masterChain.md, and the `+` on it.
describe("node insert, onto the master run", () => {
  it("splices into the empty run every template writes", async () => {
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ MIX ]\n  MIX: [ OUT ]\n",
      "utf8",
    );
    await make("audio/comp", "m1");
    await runCommand("node insert MIX OUT m1", host(), "cli");
    expect(chains()).toContain("MIX: [ m1 ]");
    expect(chains()).toContain("m1: [ OUT ]");
  });

  it("writes the run first when the file never stated it", async () => {
    // The graph DRAWS `MIX ─ OUT` whenever anything reaches the sum, so the `+` must land on a line that is not there.
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ MIX ]\n",
      "utf8",
    );
    await make("audio/comp", "m1");
    await runCommand("node insert MIX OUT m1", host(), "cli");
    expect(chains()).toContain("MIX: [ m1 ]");
    expect(chains()).toContain("m1: [ OUT ]");
  });

  it("refuses when the sum already runs somewhere else, rather than splitting it", async () => {
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ MIX ]\n  MIX: [ amp ]\n  amp: [ OUT ]\n",
      "utf8",
    );
    await make("audio/comp", "m1");
    const before = chains();
    await runCommand("node insert MIX OUT m1", host(), "cli");
    expect(logs.join(" ")).toMatch(/does not feed 'OUT'/);
    expect(chains()).toBe(before);
  });
});

// A COLD module works on audio already on disk, so the refusal belongs to the WIRING verb.
describe("a cold node", () => {
  const cold = async () => {
    mkdirSync(join(dir, "modules", "audio", "squash"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "squash", "module.yaml"),
      "cold: true\nplugin:\n  type: jsdsp\n  name: Normalize\n",
      "utf8",
    );
    await make("audio/squash", "s1");
  };

  it("is refused over a chain with no file input, and the graph is untouched", async () => {
    await cold();
    const before = chains();
    await runCommand("node insert gtr amp s1", host(), "cli");
    expect(logs.join(" ")).toContain("COLD");
    expect(chains()).toBe(before);
  });

  it("goes in once the chain draws from a file", async () => {
    await cold();
    mkdirSync(join(dir, "modules", "io", "FILE"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "io", "FILE", "module.yaml"),
      "io: file\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "take.yaml"),
      'extends: "@project/FILE"\nsource: "clips/x.wav"\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ take ]\n  take: [ amp ]\n  amp: [ OUT ]\n",
      "utf8",
    );
    await runCommand("node insert take amp s1", host(), "cli");
    expect(logs.join(" ")).not.toContain("COLD");
    expect(chains()).toContain("s1");
  });

  it("may still be CREATED wired to nothing", async () => {
    // No input yet to be wrong about; the refusal comes when it is wired.
    await cold();
    expect(logs.join(" ")).not.toContain("COLD");
    expect(chains()).toContain("s1: []");
  });
});
