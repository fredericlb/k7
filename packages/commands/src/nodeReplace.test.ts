// `node replace` and `graph unlink` — the two verbs that change a chain without deleting
// anything, and what they must never leave behind.
//
// `replace` touches one `extends:` line, and then — only when the node's name was AUTO-MADE —
// renames it to follow the new module, chains and preset with it. Both halves are asserted, and
// the sharper half is the refusal: a name somebody chose must not move an inch. `unlink` is the
// opposite shape: it rewrites the chains and must leave every FILE alone.
//
// `module delete` was tested here too, and its one failure mode was the sharpest of the three —
// a chain naming a module that no longer exists is not a cosmetic dangling reference, it is a
// project the compiler refuses to load, so the command that would repair it cannot run either.
// The verb is gone; the shape of that failure is why `unlink` still asserts the files.

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
  // One USE of `amp`, in the flat nodes/ folder, so the two deletion scopes can be told
  // apart: deleting it takes one FILE, deleting `amp` takes a whole module folder.
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

// `node replace <node> <extends-ref>` — point a node at another module. ONE line changes:
// its `extends`. It used to CREATE a module and rewrite the chains onto the new name, which
// answered a different question and asked for two things when only the replacement is worth
// naming. So what these assert hardest is what does NOT move: the chains, and the node's name.
describe("node replace", () => {
  const nodeFile = () => readFileSync(join(dir, "nodes", "lead.yaml"), "utf8");
  // Read BACK, not string-matched: what matters is the value the loader will see, and the
  // quoting is the serializer's business — `@engine/…` is not a legal plain scalar in YAML.
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
    // The trap this format keeps setting (see the timecode quoting rule): emitted bare,
    // `extends: @project/audio/cab` is not YAML at all, and the project stops loading.
    return runCommand(
      "node replace lead @project/audio/cab",
      host(),
      "cli",
    ).then(() => {
      expect(nodeExtends()).toBe("@project/audio/cab");
    });
  });

  it("drops what described the old thing, and says which", async () => {
    // `params: {Depth: 3}` addressed the old module's knobs; left behind it would be set on a
    // plugin that has no such control. An own `plugin:` is worse — it OUTRANKS the new extends.
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

// `graph unlink` — out of the SIGNAL PATH, and still in the graph, wired to nothing. Nothing is
// deleted and nothing disappears from the canvas, so putting it back is one `node insert`.
// Removing a node outright is `node delete` (nodeDelete.test.ts).
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
    // It used to be refused: a chain STARTED at a track, so there was nothing feeding it to
    // rejoin to what it fed. A lane is a module now (packages/song/docs/trackModules.md), so
    // the splice is well defined — the lane leaves the signal path and keeps its clips, which
    // is exactly what unlinking means everywhere else.
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

// --- and then the NAME follows -------------------------------------------------------
//
// A node the graph's `+` made is called `<lane>_<module>_<n>` (`@studio/song`'s instanceName.ts),
// so one still wearing `gtr_amp_1` while it extends a cab is a name that lies about the one
// thing a name here carries. The judgement being tested is which names are OURS to move — and
// what happens to the chains, the file and the preset when one does.

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
    // The FILE moved — a comment nobody could have regenerated proves it was not rewritten from
    // scratch. (`params` would be gone, and that is `setModuleExtends`: what described the old
    // module cannot describe the new one. The rename does not touch the contents at all.)
    const moved = readFileSync(join(dir, "nodes", "gtr_cab_1.yaml"), "utf8");
    expect(moved).toContain("# the one somebody wrote by hand");
    expect(moved).toContain("monitor: true");
    expect(logs.join(" ")).toContain("gtr_amp_1 → gtr_cab_1");
  });

  it("takes the node's preset with it", async () => {
    // `nodes/<node>.vstpreset` is keyed by the name, so leaving it behind would silently reset a
    // plugin's opaque state — the one part of a node nothing else can rebuild.
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
    // A mapping is the one place outside the chains where the name is a reference, and nothing
    // rewrites one — a desk pointing at a name that moved draws a knob that does nothing.
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
