// `chain connect` — the patch-cable verb, through the dispatcher, asserting chains.yaml.
// What matters: it CREATES an arrow (no existing one required, unlike `chain add`), it never
// unwires what the source already feeds, and every refusal leaves the file byte-identical.

import {
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
let reloads = 0;
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {
      reloads++;
    },
  }) as never;

const chains = () => readFileSync(join(dir, "chains.yaml"), "utf8");

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-connect-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  // `reverb` is placed and unwired — the free jacks the gesture exists for.
  writeFileSync(
    join(d, "chains.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n  reverb: []\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\nclips: []\n',
    "utf8",
  );
  for (const m of ["amp", "reverb"]) {
    const md = join(d, "modules", "audio", m);
    mkdirSync(md, { recursive: true });
    writeFileSync(
      join(md, "module.yaml"),
      "plugin:\n  type: internal\n  name: Chorus\n",
      "utf8",
    );
  }
  return d;
}

beforeEach(() => {
  dir = song();
  logs.length = 0;
  reloads = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("chain connect", () => {
  it("draws a new arrow without touching what the source already feeds", async () => {
    await runCommand("chain connect amp reverb", host(), "cli");
    expect(chains()).toContain("amp: [ OUT, reverb ]");
    expect(logs.join(" ")).toContain("connected amp → reverb");
    expect(reloads).toBe(1);
  });

  it("wires an unwired module to the sink — how a placed module joins the song", async () => {
    await runCommand("chain connect reverb OUT", host(), "cli");
    expect(chains()).toContain("reverb: [ OUT ]");
  });

  it("refuses an arrow that is already there, writing nothing", async () => {
    const before = chains();
    await runCommand("chain connect gtr amp", host(), "cli");
    expect(logs.join(" ")).toContain("already feeds");
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });

  it("refuses a node the project does not know", async () => {
    const before = chains();
    await runCommand("chain connect amp nothere", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
  });

  it("refuses the sink as a source and a track as a target", async () => {
    await runCommand("chain connect OUT reverb", host(), "cli");
    expect(logs.join(" ")).toContain("sink");
    await runCommand("chain connect reverb gtr", host(), "cli");
    expect(logs.join(" ")).toContain("is a track");
    expect(reloads).toBe(0);
  });

  it("refuses a node fed to itself, ports notwithstanding", async () => {
    await runCommand("chain connect amp#b amp", host(), "cli");
    expect(logs.join(" ")).toContain("itself");
  });
});

describe("chain add, born at the cursor", () => {
  it("a trailing x,y pins the spliced module where the + was clicked", async () => {
    await runCommand("chain add gtr amp reverb 300,140", host(), "cli");
    expect(chains()).toContain("gtr: [ reverb ]");
    expect(chains()).toContain("reverb: [ amp ]");
    expect(chains()).toContain("reverb: { x: 300, y: 140 }");
  });
});

describe("chain disconnect", () => {
  it("pulls one cable, and the module it stranded stays placed", async () => {
    await runCommand("chain disconnect amp OUT", host(), "cli");
    expect(chains()).toContain("amp: []");
    expect(chains()).toContain("gtr: [ amp ]");
    expect(reloads).toBe(1);
  });

  it("refuses an arrow that is not there, writing nothing", async () => {
    const before = chains();
    await runCommand("chain disconnect gtr reverb", host(), "cli");
    expect(logs.join(" ")).toContain("does not feed");
    expect(chains()).toBe(before);
    expect(reloads).toBe(0);
  });
});

describe("chain replug", () => {
  it("moves one end in one write — the old arrow gone, the new one there", async () => {
    // The target end of gtr→amp moves to reverb.
    await runCommand("chain replug gtr amp gtr reverb", host(), "cli");
    expect(chains()).toContain("gtr: [ reverb ]");
    expect(chains()).not.toContain("gtr: [ amp ]");
    expect(reloads).toBe(1);
  });

  it("says so when nothing moved, and writes nothing", async () => {
    const before = chains();
    await runCommand("chain replug gtr amp gtr amp", host(), "cli");
    expect(logs.join(" ")).toContain("nothing moved");
    expect(chains()).toBe(before);
  });

  it("a bad OLD arrow refuses the whole move — no half-replug", async () => {
    const before = chains();
    await runCommand("chain replug gtr reverb gtr OUT", host(), "cli");
    expect(logs.join(" ")).toContain("does not feed");
    expect(chains()).toBe(before);
  });

  it("the new pair passes the connect checks — an unknown node refuses it", async () => {
    const before = chains();
    await runCommand("chain replug gtr amp gtr nothere", host(), "cli");
    expect(logs.join(" ")).toContain('no node "nothere"');
    expect(chains()).toBe(before);
  });
});
