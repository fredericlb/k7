// `node replace` and `graph unlink` — the two verbs that change a chain without deleting
// anything, and what they must never leave behind.
//
// `replace` touches one `extends:` line and renames the node ONLY when its name was auto-made;
// the sharper assertion is the refusal, since a name somebody chose must not move. `unlink` is
// the opposite shape: it rewrites chains and must leave every FILE alone.
//
// A chain naming a missing module is a project the compiler refuses to load, and a command
// cannot repair what it cannot open — which is why `unlink` asserts the files.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
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
const modDir = (name: string) => join(dir, "modules", "audio", name);

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-moddel-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(d, "graph.yaml"),
    // Two tracks meeting at `cab`: deleting it has to rejoin BOTH of them to what it fed.
    "modules:\n  gtr: [ amp ]\n  bass: [ cab ]\n  amp: [ cab ]\n  cab: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "nodes"), { recursive: true });
  for (const t of ["gtr", "bass"])
    writeFileSync(
      join(d, "nodes", `${t}.yaml`),
      'extends: "@studio/track"\nevents: []\n',
      "utf8",
    );
  for (const m of ["amp", "cab"]) {
    const md = join(d, "modules", "audio", m);
    mkdirSync(md, { recursive: true });
    writeFileSync(
      join(md, "module.yaml"),
      "plugin:\n  type: internal\n  name: Chorus\n",
      "utf8",
    );
  }
  // One USE of `amp`, so the two scopes differ: one FILE against a whole module folder.
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(
    join(d, "nodes", "lead.yaml"),
    'extends: "@project/audio/amp"\nparams:\n  Depth: 3\n',
    "utf8",
  );
  return d;
}

beforeEach(() => {
  dir = song();
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// `node replace` changes ONE line, its `extends:` — so these assert what does NOT move.
describe("node replace", () => {
  const nodeFile = () => readFileSync(join(dir, "nodes", "lead.yaml"), "utf8");
  // Read BACK, not string-matched: `@engine/…` is not a legal plain scalar in YAML.
  const nodeExtends = () =>
    (parse(nodeFile(), { version: "1.2" }) as { extends?: string }).extends;

  it("repoints the node and leaves every chain alone", async () => {
    const before = chains();
    await runCommand("node replace lead audio/cab", host(), "cli");
    expect(nodeExtends()).toBe("audio/cab");
    // The whole point: the name is untouched, so nothing needed rewiring.
    expect(chains()).toBe(before);
    expect(existsSync(join(dir, "nodes", "lead.yaml"))).toBe(true);
  });

  it("writes an @-namespaced ref so it reads back — `@` starts no plain scalar", () => {
    // Emitted bare, `extends: @project/audio/cab` is not YAML at all and the project stops loading.
    return runCommand(
      "node replace lead @project/audio/cab",
      host(),
      "cli",
    ).then(() => {
      expect(nodeExtends()).toBe("@project/audio/cab");
    });
  });

  it("drops what described the old thing, and says which", async () => {
    // `params:` addressed the old module's knobs, and an own `plugin:` would OUTRANK the new extends.
    await runCommand("node replace lead audio/cab", host(), "cli");
    expect(nodeFile()).not.toContain("Depth");
    expect(logs.join(" ")).toContain("params");
  });

  it("repoints a MODULE folder too, not just a node", async () => {
    await runCommand("node replace amp audio/cab", host(), "cli");
    const amp = readFileSync(join(modDir("amp"), "module.yaml"), "utf8");
    expect(amp).toContain("extends: audio/cab");
    // Its own inline plugin went: an inherited one could never have won against it.
    expect(amp).not.toContain("Chorus");
    expect(existsSync(modDir("amp"))).toBe(true);
  });

  it("refuses an unknown ref and writes nothing", async () => {
    const before = nodeFile();
    await runCommand("node replace lead @nope/audio/missing", host(), "cli");
    expect(logs.join(" ")).toMatch(/failed|unknown/);
    expect(nodeFile()).toBe(before);
  });

  it("refuses to point a module at itself — an extends cycle resolves to nothing", async () => {
    const before = readFileSync(join(modDir("amp"), "module.yaml"), "utf8");
    await runCommand("node replace amp amp", host(), "cli");
    expect(logs.join(" ")).toMatch(/itself/);
    expect(readFileSync(join(modDir("amp"), "module.yaml"), "utf8")).toBe(
      before,
    );
  });

  it("asks for the replacement when only the node was named", async () => {
    const before = nodeFile();
    await runCommand("node replace lead", host(), "cli");
    expect(logs.join(" ")).toContain("usage: node replace");
    expect(nodeFile()).toBe(before);
  });
});

// `graph unlink` — out of the SIGNAL PATH, still on the canvas; removing outright is `node delete`.
describe("graph unlink", () => {
  it("closes the gap over the node and leaves its files alone", async () => {
    // `cab` is fed by `amp` on one path and by `bass` on another, so BOTH must be rejoined.
    await runCommand("graph unlink cab", host(), "cli");
    // Its cables go; its entry stays, so the node is still on the canvas.
    expect(chains()).toMatch(/cab:\s*\[\s*\]/);
    expect(chains()).toContain("amp: [ OUT ]");
    expect(chains()).toContain("bass: [ OUT ]");
    // The point of the verb: the module is still there, with its settings.
    expect(existsSync(modDir("cab"))).toBe(true);
  });

  it("unlinks a NODE without touching the module it uses", async () => {
    await runCommand("node insert gtr amp lead", host(), "cli");
    expect(chains()).toContain("lead");
    await runCommand("graph unlink lead", host(), "cli");
    expect(chains()).toMatch(/lead:\s*\[\s*\]/);
    expect(chains()).toContain("gtr: [ amp ]");
    expect(existsSync(join(dir, "nodes", "lead.yaml"))).toBe(true);
    expect(existsSync(modDir("amp"))).toBe(true);
  });

  it("unlinks a LANE now, and leaves its file on disk", async () => {
    // A lane is a module, so one name unlinks either (packages/song/docs/trackModules.md).
    await runCommand("graph unlink gtr", host(), "cli");
    expect(chains()).toMatch(/gtr:\s*\[\s*\]/);
    expect(existsSync(join(dir, "nodes", "gtr.yaml"))).toBe(true);
  });

  it("refuses a name the chains do not have, rather than quietly writing nothing", async () => {
    const before = chains();
    await runCommand("graph unlink nope", host(), "cli");
    expect(logs.join(" ")).toContain("no 'nope'");
    expect(chains()).toBe(before);
  });
});

// --- and then the NAME follows: `<lane>_<module>_<n>` lies once the module changes ---

describe("node replace — the name following the module", () => {
  /** The same song, plus a node the convention named, spliced into gtr's run. */
  beforeEach(() => {
    writeFileSync(
      join(dir, "graph.yaml"),
      "modules:\n  gtr: [ gtr_amp_1 ]\n  gtr_amp_1: [ cab ]\n  bass: [ cab ]\n  cab: [ OUT ]\n",
      "utf8",
    );
    writeFileSync(
      join(dir, "nodes", "gtr_amp_1.yaml"),
      '# the one somebody wrote by hand\nextends: "@project/audio/amp"\nmonitor: true\n',
      "utf8",
    );
  });

  const nodes = () => readdirSync(join(dir, "nodes")).sort();

  it("renames the node, and the chains follow it", async () => {
    await runCommand("node replace gtr_amp_1 audio/cab", host(), "cli");
    expect(nodes()).toContain("gtr_cab_1.yaml");
    expect(nodes()).not.toContain("gtr_amp_1.yaml");
    // Every mention: the key, what feeds it, and what it feeds.
    expect(chains()).toContain("gtr: [ gtr_cab_1 ]");
    expect(chains()).toContain("gtr_cab_1: [ cab ]");
    expect(chains()).not.toContain("gtr_amp_1");
    // The FILE moved: a comment nobody could regenerate proves it was not rewritten from scratch.
    const moved = readFileSync(join(dir, "nodes", "gtr_cab_1.yaml"), "utf8");
    expect(moved).toContain("# the one somebody wrote by hand");
    expect(moved).toContain("monitor: true");
    expect(logs.join(" ")).toContain("gtr_amp_1 → gtr_cab_1");
  });

  it("takes the node's preset with it", async () => {
    // `nodes/<node>.vstpreset` is keyed by the name, and nothing else can rebuild that state.
    writeFileSync(join(dir, "nodes", "gtr_amp_1.vstpreset"), "x", "utf8");
    await runCommand("node replace gtr_amp_1 audio/cab", host(), "cli");
    expect(nodes()).toContain("gtr_cab_1.vstpreset");
    expect(nodes()).not.toContain("gtr_amp_1.vstpreset");
  });

  it("leaves a name somebody CHOSE exactly where it is", async () => {
    // `lead` is the shared fixture's hand-named node. The chains must not move at all.
    await runCommand("node insert gtr gtr_amp_1 lead", host(), "cli");
    const before = chains();
    logs.length = 0;
    await runCommand("node replace lead audio/cab", host(), "cli");
    expect(chains()).toBe(before);
    expect(nodes()).toContain("lead.yaml");
    expect(logs.join(" ")).not.toContain("→");
  });

  it("says nothing and moves nothing when the module's name is unchanged", async () => {
    // A different ref for the same word — nothing to follow, and the counter must not walk up.
    const before = chains();
    await runCommand(
      "node replace gtr_amp_1 @project/audio/amp",
      host(),
      "cli",
    );
    expect(chains()).toBe(before);
    expect(nodes()).toContain("gtr_amp_1.yaml");
  });

  it("keeps the name a SURFACE points at, and says which file holds it", async () => {
    // A mapping is the one reference outside the chains, and nothing rewrites one.
    mkdirSync(join(dir, "surfaces"), { recursive: true });
    writeFileSync(
      join(dir, "surfaces", "desk.yaml"),
      "type: turntables\nlayout: split\nmapping:\n  crossfade: { module: gtr_amp_1, param: Mix }\n",
      "utf8",
    );
    await runCommand("node replace gtr_amp_1 audio/cab", host(), "cli");
    expect(nodes()).toContain("gtr_amp_1.yaml"); // not moved
    expect(logs.join(" ")).toContain("surface desk");
    // …and the replacement still stands. A stale name plays correctly; a half-done rename does not.
    expect(
      readFileSync(join(dir, "nodes", "gtr_amp_1.yaml"), "utf8"),
    ).toContain("audio/cab");
  });
});
