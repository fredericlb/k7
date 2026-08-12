// `module delete` and `module replace`.
//
// Both have one failure mode that matters more than anything they do right: leaving a chain naming a module
// that no longer exists. That is not a cosmetic dangling reference — the compiler refuses to load the project,
// which means the command that would fix it cannot run either. So every test here asserts chains.yaml, not the
// log, and the replace tests check the ORDER of operations rather than just the end state.

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
    reload: () => {},
  }) as never;

const chains = () => readFileSync(join(dir, "chains.yaml"), "utf8");
const modDir = (name: string) => join(dir, "modules", "audio", name);

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-moddel-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(d, "chains.yaml"),
    // Two tracks meeting at `cab`: deleting it has to rejoin BOTH of them to what it fed.
    "modules:\n  gtr: [ amp ]\n  bass: [ cab ]\n  amp: [ cab ]\n  cab: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "instances"), { recursive: true });
  for (const t of ["gtr", "bass"])
    writeFileSync(
      join(d, "instances", `${t}.yaml`),
      'extends: "@studio/audio-track"\nclips: []\n',
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
  // One USE of `amp`, in the flat instances/ folder, so the two deletion scopes can be told
  // apart: deleting it takes one FILE, deleting `amp` takes a whole module folder.
  mkdirSync(join(d, "instances"), { recursive: true });
  writeFileSync(
    join(d, "instances", "lead.yaml"),
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

describe("module delete", () => {
  it("removes the folder AND rejoins everything that named it", () => {
    // `cab` sits between `amp` and OUT on one path and between `bass` and OUT on another —
    // so deleting it has to close BOTH gaps, not just the first one it finds.
    return runCommand("module delete cab", host(), "cli").then(() => {
      expect(existsSync(modDir("cab"))).toBe(false);
      expect(chains()).not.toContain("cab");
      expect(chains()).toContain("gtr: [ amp ]");
      expect(chains()).toContain("amp: [ OUT ]");
      expect(chains()).toContain("bass: [ OUT ]");
    });
  });

  it("deletes ONE instance file and leaves the module it uses alone", async () => {
    await runCommand("module delete lead", host(), "cli");
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(false);
    expect(existsSync(join(modDir("amp"), "module.yaml"))).toBe(true);
    // The instances FOLDER survives: it is shared by every use in the project, so deleting one
    // must never take it — the failure that would be, on a real song, is everything at once.
    expect(existsSync(join(dir, "instances"))).toBe(true);
    // …and the module is still wired up: deleting a use must not unwire what it used.
    expect(chains()).toContain("gtr: [ amp ]");
  });

  it("takes a module's own folder whole", async () => {
    await runCommand("module delete amp", host(), "cli");
    expect(existsSync(modDir("amp"))).toBe(false);
  });

  it("says so and changes nothing when the module does not exist", async () => {
    const before = chains();
    await runCommand("module delete nope", host(), "cli");
    expect(logs.join(" ")).toContain("no module");
    expect(chains()).toBe(before);
  });
});

describe("module replace", () => {
  it("keeps the module's PLACE, which is what delete-then-add would lose", async () => {
    await runCommand("module replace amp audio/fuzz", host(), "cli");
    // fuzz sits where amp sat: fed by gtr, feeding cab.
    expect(chains()).toContain("gtr: [ fuzz ]");
    expect(chains()).toContain("fuzz: [ cab ]");
    expect(chains()).not.toContain("amp");
    expect(existsSync(modDir("fuzz"))).toBe(true);
    expect(existsSync(modDir("amp"))).toBe(false);
  });

  it("replaces every reference to it, not just the first", async () => {
    // `cab` is named three times: as a destination by `amp` and by `bass`, and as its own
    // entry. Missing any one leaves a name pointing at a module that no longer exists.
    await runCommand("module replace cab audio/ir", host(), "cli");
    expect(chains().match(/\bir\b/g)).toHaveLength(3);
    expect(chains()).not.toContain("cab");
  });

  it("leaves the old module wired up when the new one cannot be created", async () => {
    // A bad `extends` is the realistic failure. The old module must survive it — a half-done replace would be
    // a project that no longer loads, and the command to repair it needs the project to load.
    const before = chains();
    await runCommand(
      "module replace amp audio/fuzz @nope/audio/missing",
      host(),
      "cli",
    );
    expect(logs.join(" ")).toMatch(/failed/);
    expect(chains()).toBe(before);
    expect(existsSync(modDir("amp"))).toBe(true);
  });
});

// `module instance unlink` — the same splice, the opposite intention: out of the signal path,
// still on disk. Deleting cannot be undone by re-wiring; unlinking can.
describe("module instance unlink", () => {
  it("closes the gap over the node and leaves its files alone", async () => {
    // `cab` is fed by `amp` on one path and by `bass` on another, so BOTH must be rejoined.
    await runCommand("module instance unlink cab", host(), "cli");
    expect(chains()).not.toContain("cab");
    expect(chains()).toContain("amp: [ OUT ]");
    expect(chains()).toContain("bass: [ OUT ]");
    // The whole difference from `module delete`.
    expect(existsSync(modDir("cab"))).toBe(true);
  });

  it("unlinks an INSTANCE without touching the module it uses", async () => {
    await runCommand("chain add gtr amp lead", host(), "cli");
    expect(chains()).toContain("lead");
    await runCommand("module instance unlink lead", host(), "cli");
    expect(chains()).not.toContain("lead");
    expect(chains()).toContain("gtr: [ amp ]");
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(true);
    expect(existsSync(modDir("amp"))).toBe(true);
  });

  it("unlinks a LANE now, and leaves its file on disk", async () => {
    // It used to be refused: a chain STARTED at a track, so there was nothing feeding it to
    // rejoin to what it fed. A lane is a module now (packages/song/docs/trackModules.md), so
    // the splice is well defined — the lane leaves the signal path and keeps its clips, which
    // is exactly what unlinking means everywhere else.
    await runCommand("module instance unlink gtr", host(), "cli");
    expect(chains()).not.toContain("gtr:");
    expect(existsSync(join(dir, "instances", "gtr.yaml"))).toBe(true);
  });

  it("refuses a name the chains do not have, rather than quietly writing nothing", async () => {
    const before = chains();
    await runCommand("module instance unlink nope", host(), "cli");
    expect(logs.join(" ")).toContain("no 'nope'");
    expect(chains()).toBe(before);
  });
});
