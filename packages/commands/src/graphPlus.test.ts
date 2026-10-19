// What the graph's `+` and its right-click end up writing: `node new` and `node insert`.
//
// Both take a node that EXISTS — one drops it in the graph wired to NOTHING, the other splices
// it into an arrow — and neither creates anything: creating is `module new`'s
// (packages/song/docs/nodes.md), so the picker writes two lines and these are the second.
//
// The failure worth guarding against is still the quiet one: naming in graph.k7x something
// that has no file, which is exactly what the compiler refuses to load.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

type Graph = {
  modules?: Record<string, string[]>;
  positions?: Record<string, { x: number; y: number }>;
};
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

const AMP = "@workspace/audio/amp";
const graphFile = () => join(dir, "graph.k7x");
const chains = () => readFileSync(graphFile(), "utf8");
const graph = () => wsData(graphFile()) as Graph;
const modules = () => graph().modules ?? {};
const pin = (node: string) => graph().positions?.[node];
const writeGraph = (value: Graph) => writeDoc(graphFile(), value);
/** The picker's two lines: `module new` makes no node, so this is two commands. */
const make = async (target: string, node: string) => {
  await runCommand(`module new ${target}`, host(), "cli");
  await runCommand(`node new ${target} ${node}`, host(), "cli");
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-place-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t", tempo: 120 } });
  writeGraph({ modules: { gtr: [AMP], [AMP]: ["OUT"] } });
  writeDoc(join(dir, "nodes", "gtr.k7x"), {
    extends: "@meta/track",
    events: [],
  });
  // A module lives at `@workspace` now — beside the project, in the workspace's own `_modules`.
  writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Chorus" },
  });
  logs.length = 0;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("module new — the creating half", () => {
  it("writes the MODULE and nothing else — no node, no chain", async () => {
    const before = chains();
    await runCommand("module new audio/wah", host(), "cli");
    expect(
      existsSync(join(root, "_modules", "audio", "wah", "module.k7x")),
    ).toBe(true);
    // A module is not a use of one. `node new` makes those, and it is what a chain names.
    expect(existsSync(join(dir, "nodes", "wah.k7x"))).toBe(false);
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
    // …and it touched nothing that was already wired.
    expect(modules()).toEqual({ gtr: [AMP], [AMP]: ["OUT"], w1: [] });
  });

  it("puts one nobody placed above the origin rather than wherever the layout would", async () => {
    await make("audio/wah", "w1");
    expect(pin("w1")).toEqual({ x: 0, y: -30 });
  });

  it("…and where the cursor was when there was one, negative Y included", async () => {
    await runCommand("module new audio/wah", host(), "cli");
    await runCommand("node new audio/wah w1 -40,-120", host(), "cli");
    expect(pin("w1")).toEqual({ x: -40, y: -120 });
  });
});

describe("node insert", () => {
  it("splices an existing node into the arrow", async () => {
    await make("audio/gate", "g1");
    await runCommand(`node insert gtr ${AMP} g1`, host(), "cli");
    expect(modules()).toMatchObject({
      gtr: ["g1"],
      g1: [AMP],
      [AMP]: ["OUT"],
    });
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
    await runCommand(`node insert gtr ${AMP} nope`, host(), "cli");
    expect(logs.join(" ")).toMatch(/no node "nope"/);
    expect(chains()).toBe(before);
  });

  it("lands halfway along the cable when no cursor said where", async () => {
    // The drawing writes its own pins down (`graph pin`), so by the time anything is spliced the two ends have them.
    writeGraph({
      modules: { gtr: [AMP], [AMP]: ["OUT"] },
      positions: { gtr: { x: 100, y: 40 }, [AMP]: { x: 500, y: 140 } },
    });
    await make("audio/gate", "g1");
    await runCommand(`node insert gtr ${AMP} g1`, host(), "cli");
    expect(pin("g1")).toEqual({ x: 300, y: 90 });
  });

  it("keeps the pin it was born with when the two ends have none", async () => {
    // Nothing to be halfway BETWEEN — a graph.k7x no drawing has ever pinned, which is a CLI-only project.
    await make("audio/gate", "g1");
    await runCommand(`node insert gtr ${AMP} g1`, host(), "cli");
    expect(pin("g1")).toEqual({ x: 0, y: -30 });
  });
});

// The master run is the arrow `MIX: [ OUT ]` — packages/song/docs/masterChain.md, and the `+` on it.
describe("node insert, onto the master run", () => {
  it("splices into the empty run every template writes", async () => {
    writeGraph({ modules: { gtr: ["MIX"], MIX: ["OUT"] } });
    await make("audio/comp", "m1");
    await runCommand("node insert MIX OUT m1", host(), "cli");
    expect(modules()).toMatchObject({ MIX: ["m1"], m1: ["OUT"] });
  });

  it("writes the run first when the file never stated it", async () => {
    // The graph DRAWS `MIX ─ OUT` whenever anything reaches the sum, so the `+` must land on a line that is not there.
    writeGraph({ modules: { gtr: ["MIX"] } });
    await make("audio/comp", "m1");
    await runCommand("node insert MIX OUT m1", host(), "cli");
    expect(modules()).toMatchObject({ MIX: ["m1"], m1: ["OUT"] });
  });

  it("refuses when the sum already runs somewhere else, rather than splitting it", async () => {
    writeGraph({ modules: { gtr: ["MIX"], MIX: [AMP], [AMP]: ["OUT"] } });
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
    writeDoc(join(root, "_modules", "audio", "squash", "module.k7x"), {
      cold: true,
      plugin: { type: "jsdsp", name: "Normalize" },
    });
    await make("audio/squash", "s1");
  };

  it("is refused over a chain with no file input, and the graph is untouched", async () => {
    await cold();
    const before = chains();
    await runCommand(`node insert gtr ${AMP} s1`, host(), "cli");
    expect(logs.join(" ")).toContain("COLD");
    expect(chains()).toBe(before);
  });

  it("goes in once the chain draws from a file", async () => {
    await cold();
    // io is a plain NODE now, never a shared module — one file carries the whole of it.
    writeDoc(join(dir, "nodes", "take.k7x"), {
      io: "file",
      source: "clips/x.wav",
    });
    writeGraph({ modules: { gtr: ["take"], take: [AMP], [AMP]: ["OUT"] } });
    await runCommand(`node insert take ${AMP} s1`, host(), "cli");
    expect(logs.join(" ")).not.toContain("COLD");
    expect(modules()).toMatchObject({ take: ["s1"], s1: [AMP] });
  });

  it("may still be CREATED wired to nothing", async () => {
    // No input yet to be wrong about; the refusal comes when it is wired.
    await cold();
    expect(logs.join(" ")).not.toContain("COLD");
    expect(modules().s1).toEqual([]);
  });
});
