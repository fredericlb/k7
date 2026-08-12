// What the graph's `+` and its right-click write: `module insert` and `module place`.
//
// They are one command with and without an arrow — both create the module, then one splices it into an edge and
// the other drops it in wired to NOTHING. The failure worth guarding against is the quiet one: creating the
// folder and leaving chains.yaml alone, which makes a module the file never mentions. That is indistinguishable
// from a module you forgot about, and the graph is the only place it could have been connected from.

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-place-"));
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "chains.yaml"),
    "modules:\n  gtr: [ amp ]\n  amp: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(dir, "instances"), { recursive: true });
  writeFileSync(
    join(dir, "instances", "gtr.yaml"),
    'extends: "@studio/audio-track"\nclips: []\n',
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

describe("module place", () => {
  it("creates the module AND names it in the graph, wired to nothing", () => {
    return runCommand("module place audio/wah", host(), "cli").then(() => {
      expect(
        existsSync(join(dir, "modules", "audio", "wah", "module.yaml")),
      ).toBe(true);
      expect(chains()).toContain("wah: []");
      // …and it touched nothing that was already wired.
      expect(chains()).toContain("gtr: [ amp ]");
      expect(chains()).toContain("amp: [ OUT ]");
    });
  });

  it("places an INSTANCE when one is named", async () => {
    // The picker always asks for an instance name, so this is the common path, not the edge.
    // The file lands in the project's flat instances/, and the chain names it by that alone.
    await runCommand("module place audio/wah w1", host(), "cli");
    expect(existsSync(join(dir, "instances", "w1.yaml"))).toBe(true);
    expect(chains()).toContain("w1: []");
  });

  it("reads a lone optional by its SHAPE, not its position", async () => {
    // The picker writes no extends-ref for a module the project already has, so the
    // instance the user types arrives where a ref would sit. `lead` has no slash, so it is
    // an instance name — the alternative was "module 'amp' already exists, drop the
    // extends-ref" about a ref they never wrote.
    await runCommand("module place audio/amp lead", host(), "cli");
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(true);
    expect(chains()).toContain("lead: []");
    // The generic keeps its own wiring: placing an instance is not a rewire of its parent.
    expect(chains()).toContain("gtr: [ amp ]");
  });

  it("changes nothing when the target is not <category>/<name>", async () => {
    const before = chains();
    await runCommand("module place wah", host(), "cli");
    expect(logs.join(" ")).toMatch(/is not <category>\/<name>/);
    expect(chains()).toBe(before);
  });

  it("leaves the graph alone when the module cannot be created", async () => {
    // A bad `extends` is the realistic failure. Writing the node anyway would leave
    // chains.yaml naming a module with no file — which is what the compiler refuses.
    const before = chains();
    await runCommand(
      "module place audio/wah @nope/audio/missing",
      host(),
      "cli",
    );
    expect(logs.join(" ")).toMatch(/failed/);
    expect(chains()).toBe(before);
  });
});

describe("module insert", () => {
  it("creates the module and splices it into the arrow", async () => {
    await runCommand("module insert gtr amp audio/gate", host(), "cli");
    expect(chains()).toContain("gtr: [ gate ]");
    expect(chains()).toContain("gate: [ amp ]");
    expect(chains()).toContain("amp: [ OUT ]");
  });

  it("reads a lone optional by its shape here too", async () => {
    // The same slot as `module place`, and the same picker feeds it: for a module the
    // project already has, what the user types after the target is an instance name.
    await runCommand("module insert gtr amp audio/amp lead", host(), "cli");
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(true);
    expect(chains()).toContain("gtr: [ lead ]");
    expect(chains()).toContain("lead: [ amp ]");
  });

  it("creates nothing when the two ends aren't an arrow", async () => {
    // Checked BEFORE the module is made, so a bad drop leaves no orphan folder behind.
    const before = chains();
    await runCommand("module insert gtr OUT audio/gate", host(), "cli");
    expect(logs.join(" ")).toMatch(/does not feed 'OUT'/);
    expect(existsSync(join(dir, "modules", "audio", "gate"))).toBe(false);
    expect(chains()).toBe(before);
  });
});

// A COLD module only works on audio already on disk. The refusal has to come BEFORE the module
// is created, or a rejected drop leaves a folder behind — the same rule the arrow check follows.
describe("a cold module", () => {
  const cold = () => {
    mkdirSync(join(dir, "modules", "audio", "squash"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "audio", "squash", "module.yaml"),
      "cold: true\nplugin:\n  type: jsdsp\n  name: Normalize\n",
      "utf8",
    );
  };

  it("is refused over a chain with no file input, and writes NOTHING", async () => {
    cold();
    const before = chains();
    await runCommand("module insert gtr amp audio/squash s1", host(), "cli");
    expect(logs.join(" ")).toContain("COLD");
    expect(chains()).toBe(before);
    // The instance was never scaffolded: a refusal that half-succeeds is the failure this guards.
    expect(existsSync(join(dir, "instances", "s1.yaml"))).toBe(false);
  });

  it("goes in once the chain draws from a file", async () => {
    cold();
    mkdirSync(join(dir, "modules", "io", "FILE"), { recursive: true });
    writeFileSync(
      join(dir, "modules", "io", "FILE", "module.yaml"),
      "io: file\n",
      "utf8",
    );
    mkdirSync(join(dir, "instances"), { recursive: true });
    writeFileSync(
      join(dir, "instances", "take.yaml"),
      'extends: "@project/FILE"\nsource: "clips/x.wav"\n',
      "utf8",
    );
    writeFileSync(
      join(dir, "chains.yaml"),
      "modules:\n  gtr: [ take ]\n  take: [ amp ]\n  amp: [ OUT ]\n",
      "utf8",
    );
    await runCommand("module insert take amp audio/squash s1", host(), "cli");
    expect(logs.join(" ")).not.toContain("COLD");
    expect(chains()).toContain("s1");
    expect(existsSync(join(dir, "instances", "s1.yaml"))).toBe(true);
  });

  it("may still be PLACED wired to nothing", async () => {
    // No input yet to be wrong about; the refusal comes when it is wired.
    cold();
    await runCommand("module place audio/squash s1", host(), "cli");
    expect(logs.join(" ")).not.toContain("COLD");
    expect(chains()).toContain("s1: []");
  });
});

// The two trailing optionals are POSITIONAL once both are given, so naming an instance of a
// module that already exists meant also passing a ref — which is exactly what the refusal was
// about. That left no way to do an ordinary thing: reuse a module the project already has.
describe("instancing a module that already exists", () => {
  it("takes the instance name even when a redundant extends-ref rides along", async () => {
    await runCommand(
      "module insert gtr amp audio/amp @engine/chorus lead",
      host(),
      "cli",
    );
    expect(logs.join(" ")).not.toContain("already exists");
    // The chain names the INSTANCE file, and the instance landed beside the module.
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(true);
    expect(chains()).toContain("lead");
  });

  it("still refuses a ref with no instance to justify it", async () => {
    // Nothing to do with the ref but ignore it, and ignoring what was typed is how a command
    // lies. The message names BOTH ways out now, not just dropping the ref.
    await runCommand(
      "module insert gtr amp audio/amp @engine/chorus",
      host(),
      "cli",
    );
    const said = logs.join(" ");
    expect(said).toContain("already exists");
    expect(said).toContain("instance name");
  });

  it("refuses a ref that DISAGREES with what the module extends", async () => {
    // Redundant is fine; contradictory is not. Instancing cannot re-parent the module, so
    // proceeding would silently drop the parent that was asked for.
    writeFileSync(
      join(dir, "modules", "audio", "amp", "module.yaml"),
      'extends: "@mediatek/audio/amps/real"\n',
      "utf8",
    );
    await runCommand(
      "module insert gtr amp audio/amp @engine/other lead",
      host(),
      "cli",
    );
    const said = logs.join(" ");
    expect(said).toContain("@mediatek/audio/amps/real");
    expect(existsSync(join(dir, "instances", "lead.yaml"))).toBe(false);
  });
});
