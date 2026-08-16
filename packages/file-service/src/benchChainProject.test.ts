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
let prevHome: string | undefined;

/** The bench's workspace, which is where the library submodule is mounted. */
const benchRoot = (): string =>
  join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE);

/** …and the chain inside it. This is what used to be `$STUDIO_MEDIATEK/chains/…`. */
const libraryChain = (): string => join(benchRoot(), "_libraries", CHAIN);

/**
 * The URI the account's libraries are registered under.
 *
 * Never fetched here: the mount is pre-populated below, so `ensureLibraries` finds it and
 * returns without touching git. That is the point — this test is about the chain's round trip
 * through the filesystem, not about cloning.
 */
const LIBRARIES_URI = "git@example.test:studio/libraries.git";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "td-benchchain-home-"));
  prevHome = process.env.HOME;
  // Off the real machine: this test WRITES to a library checkout, which is the whole point of
  // it, and the user's own is not a fixture.
  process.env.HOME = home;

  // The library submodule, laid out by hand where the file service would have cloned it.
  mkdirSync(join(libraryChain(), "nodes"), { recursive: true });
  writeFileSync(join(libraryChain(), "graph.yaml"), SOURCE, "utf8");
  writeFileSync(
    join(libraryChain(), "nodes", "comp.yaml"),
    'extends: "@st0/audio/comp"\nparams:\n  Ratio: 4\n',
    "utf8",
  );
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** The bench project folder for the chain, as the service lays it out. */
const benchDir = (project: string): string =>
  join(rootDir(), slugify(EMAIL), BENCH_WORKSPACE, project);

describe("a médiathèque chain, opened on the bench", () => {
  it("is a project whose chain is the bench's own wiring", async () => {
    const { workspace, project } = await ensureChainBench(
      EMAIL,
      CHAIN,
      LIBRARIES_URI,
    );
    expect(workspace).toBe(BENCH_WORKSPACE);
    expect(project).toBe(`${CHAIN}.l8`);

    const dir = benchDir(project);
    expect(existsSync(join(dir, "project.yaml"))).toBe(true);
    const chains = readFileSync(join(dir, "graph.yaml"), "utf8");
    expect(chains).toContain("banc:");
    expect(chains).not.toContain("@in");
    // The chain's own settings came with it — a chain is its routing AND its nodes.
    expect(existsSync(join(dir, "nodes", "comp.yaml"))).toBe(true);
  });

  it("puts the chain back as it was when the bench saves it", async () => {
    const { project } = await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    const root = benchRoot();
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    // Saved untouched: whatever the bench opened must be what the catalogue gets back, or every
    // open-and-close of a chain would rewrite it.
    const opened = readFileSync(join(benchDir(project), "graph.yaml"), "utf8");
    ws.write(`${project}/graph.yaml`, opened);

    const back = readFileSync(join(libraryChain(), "graph.yaml"), "utf8");
    expect(back).toContain('"@in": [ comp ]');
    expect(back).toContain('comp: [ "@out" ]');
    expect(back).toContain("# Voix live");
    expect(back).not.toContain("banc");
    expect(back).not.toContain("mixer");
  });

  it("carries a module ADDED on the bench into the chain", async () => {
    const { project } = await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    const root = benchRoot();
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    // What editing a chain on the bench actually looks like: a module spliced in before the
    // strip, which is the bench's stand-in for `@out`.
    ws.write(
      `${project}/graph.yaml`,
      "modules:\n  banc: [ comp ]\n  comp: [ reverb ]\n  reverb: [ mixer ]\n  mixer: [ OUT ]\n",
    );
    const back = readFileSync(join(libraryChain(), "graph.yaml"), "utf8");
    expect(back).toContain("comp: [ reverb ]");
    expect(back).toContain('reverb: [ "@out" ]');
    expect(back).not.toContain("mixer");
  });

  it("sends a node back too, and leaves the furniture here", async () => {
    const { project } = await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    const root = benchRoot();
    const ws = new Workspace(root);
    ws.setActiveProject(project);

    ws.write(
      `${project}/nodes/comp.yaml`,
      'extends: "@st0/audio/comp"\nparams:\n  Ratio: 8\n',
    );
    expect(
      readFileSync(join(libraryChain(), "nodes", "comp.yaml"), "utf8"),
    ).toContain("Ratio: 8");

    // The bench's LANE is somewhere to put material, and has no business in a chain other
    // projects load. It is a node like the module above, so what keeps it here is its
    // NAME — the bench's own furniture — rather than which folder it sits in.
    ws.write(
      `${project}/nodes/banc.yaml`,
      'extends: "@studio/audio-track"\nevents: []\n',
    );
    expect(existsSync(join(libraryChain(), "nodes", "banc.yaml"))).toBe(false);
  });

  it("writes a shared module in place, with no fork and no push", async () => {
    // This used to answer `{ pushed: true }`: the bench's `modules/` was a mirror of a
    // machine-wide cache, so a save there had to be pushed to the hosted médiathèque or the
    // next open would discard it. The library is a submodule now, so a shared module is an
    // ORDINARY path — written where it is, and published by `project commit` when somebody
    // decides to. No mirror to be discarded by, and nothing to fire and forget.
    const { project } = await ensureChainBench(EMAIL, CHAIN, LIBRARIES_URI);
    const ws = new Workspace(benchRoot());
    ws.setActiveProject(project);

    const rel = "_libraries/modules/audio/comp/module.yaml";
    expect(ws.write(rel, "plugin:\n  type: internal\n")).toEqual({});
    expect(readFileSync(join(benchRoot(), rel), "utf8")).toContain("internal");
  });

  it("refuses a chain that already calls something what the bench calls its own", async () => {
    const odd = join(benchRoot(), "_libraries", "chains/odd");
    mkdirSync(odd, { recursive: true });
    writeFileSync(
      join(odd, "graph.yaml"),
      'modules:\n  "@in": [ mixer ]\n  mixer: [ "@out" ]\n',
      "utf8",
    );
    await expect(
      ensureChainBench(EMAIL, "chains/odd", LIBRARIES_URI),
    ).rejects.toThrow(/mixer/);
    // And nothing was made — a refusal that left a half-built project behind would open next time.
    expect(existsSync(benchDir("chains/odd.l8"))).toBe(false);
  });
});
