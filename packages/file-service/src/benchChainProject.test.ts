// Opening a médiathèque chain on the bench and saving it back. The translation itself is proved
// in `@studio/song` (benchChain.test.ts); what is proved HERE is the round trip through the
// filesystem — because this is the one path in the service that writes to a SHARED catalogue,
// and a save that got it wrong would damage a chain other projects use.

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
import { rootDir } from "@studio/engine-client/paths";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCH_WORKSPACE, ensureChainBench } from "./bench.ts";
import { slugify } from "./slug.ts";
import { Workspace } from "./workspace.ts";

const EMAIL = "someone@example.test";
const CHAIN = "chains/live/vocals";

// A chain as the médiathèque holds one: a header saying what it IS, and `@in → module → @out`.
const SOURCE = `# Voix live — compresseur puis réverbe.
modules:
  "@in": [ comp ]
  comp: [ "@out" ]
`;

let home: string;
let mediatek: string;
let prevHome: string | undefined;
let prevMediatek: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-benchchain-home-"));
  mediatek = mkdtempSync(join(tmpdir(), "td-benchchain-med-"));
  prevHome = process.env.HOME;
  prevMediatek = process.env.STUDIO_MEDIATEK;
  // Both roots moved off the real machine: this test WRITES to a médiathèque, which is the
  // whole point of it, and the user's own is not a fixture.
  process.env.HOME = home;
  process.env.STUDIO_MEDIATEK = mediatek;

  mkdirSync(join(mediatek, CHAIN, "nodes"), { recursive: true });
  writeFileSync(join(mediatek, CHAIN, "chains.yaml"), SOURCE, "utf8");
  writeFileSync(
    join(mediatek, CHAIN, "nodes", "comp.yaml"),
    'extends: "@mediatek/audio/comp"\nparams:\n  Ratio: 4\n',
    "utf8",
  );
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevMediatek === undefined) delete process.env.STUDIO_MEDIATEK;
  else process.env.STUDIO_MEDIATEK = prevMediatek;
  rmSync(home, { recursive: true, force: true });
  rmSync(mediatek, { recursive: true, force: true });
});

/** The bench project folder for the chain, as the service lays it out. */
const benchDir = (project: string): string =>
  join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE, project);

describe("a médiathèque chain, opened on the bench", () => {
  it("is a project whose chain is the bench's own wiring", () => {
    const { workspace, project } = ensureChainBench(EMAIL, CHAIN);
    expect(workspace).toBe(BENCH_WORKSPACE);
    expect(project).toBe(`${CHAIN}.l8`);

    const dir = benchDir(project);
    expect(existsSync(join(dir, "project.yaml"))).toBe(true);
    const chains = readFileSync(join(dir, "chains.yaml"), "utf8");
    expect(chains).toContain("banc:");
    expect(chains).not.toContain("@in");
    // The chain's own settings came with it — a chain is its routing AND its nodes.
    expect(existsSync(join(dir, "nodes", "comp.yaml"))).toBe(true);
  });

  it("puts the chain back as it was when the bench saves it", () => {
    const { project } = ensureChainBench(EMAIL, CHAIN);
    const root = join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    // Saved untouched: whatever the bench opened must be what the catalogue gets back, or every
    // open-and-close of a chain would rewrite it.
    const opened = readFileSync(join(benchDir(project), "chains.yaml"), "utf8");
    ws.write(`${project}/chains.yaml`, opened);

    const back = readFileSync(join(mediatek, CHAIN, "chains.yaml"), "utf8");
    expect(back).toContain('"@in": [ comp ]');
    expect(back).toContain('comp: [ "@out" ]');
    expect(back).toContain("# Voix live");
    expect(back).not.toContain("banc");
    expect(back).not.toContain("mixer");
  });

  it("carries a module ADDED on the bench into the chain", () => {
    const { project } = ensureChainBench(EMAIL, CHAIN);
    const root = join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    // What editing a chain on the bench actually looks like: a module spliced in before the
    // strip, which is the bench's stand-in for `@out`.
    ws.write(
      `${project}/chains.yaml`,
      "modules:\n  banc: [ comp ]\n  comp: [ reverb ]\n  reverb: [ mixer ]\n  mixer: [ OUT ]\n",
    );
    const back = readFileSync(join(mediatek, CHAIN, "chains.yaml"), "utf8");
    expect(back).toContain("comp: [ reverb ]");
    expect(back).toContain('reverb: [ "@out" ]');
    expect(back).not.toContain("mixer");
  });

  it("sends a node back too, and leaves the furniture here", () => {
    const { project } = ensureChainBench(EMAIL, CHAIN);
    const root = join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    ws.write(
      `${project}/nodes/comp.yaml`,
      'extends: "@mediatek/audio/comp"\nparams:\n  Ratio: 8\n',
    );
    expect(
      readFileSync(join(mediatek, CHAIN, "nodes", "comp.yaml"), "utf8"),
    ).toContain("Ratio: 8");

    // The bench's LANE is somewhere to put material, and has no business in a chain other
    // projects load. It is a node like the module above, so what keeps it here is its
    // NAME — the bench's own furniture — rather than which folder it sits in.
    ws.write(
      `${project}/nodes/banc.yaml`,
      'extends: "@studio/audio-track"\nclips: []\n',
    );
    expect(existsSync(join(mediatek, CHAIN, "nodes", "banc.yaml"))).toBe(false);
  });

  it("takes a module save as the bench's, which is what `pushed` says", () => {
    // The regression this fixed: `write()` joined the ALREADY-ABSOLUTE active project onto the
    // root, so no path was ever under the bench's modules folder and a module saved here went
    // nowhere near the catalogue. Answered by the flag rather than by a file, because the push
    // itself is to a HOSTED library and there is none in a test.
    const { project } = ensureChainBench(EMAIL, CHAIN);
    const root = join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);
    const ws = new Workspace(root);
    ws.setActiveProject(project);
    expect(
      ws.write(
        `${project}/modules/audio/comp/module.yaml`,
        "plugin:\n  type: internal\n",
      ),
    ).toEqual({ pushed: true });
  });

  it("refuses a chain that already calls something what the bench calls its own", () => {
    mkdirSync(join(mediatek, "chains/odd"), { recursive: true });
    writeFileSync(
      join(mediatek, "chains/odd/chains.yaml"),
      'modules:\n  "@in": [ mixer ]\n  mixer: [ "@out" ]\n',
      "utf8",
    );
    expect(() => ensureChainBench(EMAIL, "chains/odd")).toThrow(/mixer/);
    // And nothing was made — a refusal that left a half-built project behind would open next time.
    expect(existsSync(benchDir("chains/odd.l8"))).toBe(false);
  });
});
