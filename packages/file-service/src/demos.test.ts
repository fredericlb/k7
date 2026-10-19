// mirrorDemos keeps a user's Examples on par with the bundled demos — it overwrites
// and re-creates demo folders but must never touch the user's own projects. That's a
// data-losing operation run on an update or a reset, so its boundaries are worth pinning.

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
import {
  DEMOS_STAMP,
  demosStamp,
  EXAMPLES_WORKSPACE,
  isManagedDemo,
  mirrorDemos,
  mirrorDemosStamped,
  syncExamples,
} from "./demos.ts";

let work: string;
let bundle: string;
let examples: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "td-demos-"));
  bundle = join(work, "bundle");
  examples = join(work, "examples");
  // A fake bundle of two demos, pointed at via the env demosDir() honors first.
  mkdirSync(join(bundle, "demoA"), { recursive: true });
  writeFileSync(join(bundle, "demoA", "project.yaml"), "A v1");
  mkdirSync(join(bundle, "demoB"), { recursive: true });
  writeFileSync(join(bundle, "demoB", "project.yaml"), "B v1");
  process.env.STUDIO_DEMOS = bundle;
});

afterEach(() => {
  delete process.env.STUDIO_DEMOS;
  rmSync(work, { recursive: true, force: true });
});

describe("mirrorDemos", () => {
  it("creates every bundled demo in a fresh Examples", () => {
    const synced = mirrorDemos(examples);
    expect(synced.sort()).toEqual(["demoA", "demoB"]);
    expect(readFileSync(join(examples, "demoA", "project.yaml"), "utf8")).toBe(
      "A v1",
    );
  });

  it("overwrites an edited demo back to the bundled version", () => {
    mirrorDemos(examples);
    writeFileSync(join(examples, "demoA", "project.yaml"), "USER TAMPERED");
    mirrorDemos(examples);
    expect(readFileSync(join(examples, "demoA", "project.yaml"), "utf8")).toBe(
      "A v1",
    );
  });

  it("re-creates a demo the user deleted", () => {
    mirrorDemos(examples);
    rmSync(join(examples, "demoA"), { recursive: true, force: true });
    mirrorDemos(examples);
    expect(existsSync(join(examples, "demoA", "project.yaml"))).toBe(true);
  });

  it("removes a stray file the user added INSIDE a demo (wholesale mirror)", () => {
    mirrorDemos(examples);
    writeFileSync(join(examples, "demoA", "notes.txt"), "mine");
    mirrorDemos(examples);
    expect(existsSync(join(examples, "demoA", "notes.txt"))).toBe(false);
  });

  it("never touches the user's own project (a non-demo folder)", () => {
    mirrorDemos(examples);
    mkdirSync(join(examples, "my-song"), { recursive: true });
    writeFileSync(join(examples, "my-song", "project.yaml"), "MINE");
    mirrorDemos(examples);
    expect(
      readFileSync(join(examples, "my-song", "project.yaml"), "utf8"),
    ).toBe("MINE");
  });

  it("picks up a newly shipped demo on the next mirror", () => {
    mirrorDemos(examples);
    mkdirSync(join(bundle, "demoC"), { recursive: true });
    writeFileSync(join(bundle, "demoC", "project.yaml"), "C v1");
    const synced = mirrorDemos(examples);
    expect(synced).toContain("demoC");
    expect(existsSync(join(examples, "demoC", "project.yaml"))).toBe(true);
  });

  it("is a no-op (no throw) when there is no bundle", () => {
    delete process.env.STUDIO_DEMOS;
    // A bare temp path makes `demosDir()` null; in this repo the walk-up may still find the real songs.
    expect(() => mirrorDemos(join(work, "nope"))).not.toThrow();
  });
});

describe("isManagedDemo", () => {
  it("is a bundled folder at the top of Examples, and nothing else", () => {
    expect(isManagedDemo(EXAMPLES_WORKSPACE, "demoA")).toBe(true);
    expect(isManagedDemo(EXAMPLES_WORKSPACE, "my-song")).toBe(false);
    expect(isManagedDemo(EXAMPLES_WORKSPACE, "sub/demoA")).toBe(false);
    expect(isManagedDemo("band", "demoA")).toBe(false);
  });
});

describe("syncExamples, at startup", () => {
  let home: string;
  let demoA: string;
  beforeEach(() => {
    home = join(work, "home");
    process.env.STUDIO_HOME = home;
    demoA = join(
      home,
      "workspace",
      EXAMPLES_WORKSPACE,
      "demoA",
      "project.yaml",
    );
  });
  afterEach(() => {
    delete process.env.STUDIO_HOME;
  });

  it("stocks Examples the first time, and stamps it with the bundle", () => {
    syncExamples();
    expect(readFileSync(demoA, "utf8")).toBe("A v1");
    const stamp = join(home, "workspace", EXAMPLES_WORKSPACE, DEMOS_STAMP);
    expect(readFileSync(stamp, "utf8").trim()).toBe(demosStamp());
  });

  // The point of the stamp: a restart is not an update, and an edited demo survives it.
  it("leaves an edited demo alone on a start of the same build", () => {
    syncExamples();
    writeFileSync(demoA, "MY EDIT");
    syncExamples();
    expect(readFileSync(demoA, "utf8")).toBe("MY EDIT");
  });

  it("puts the demos back once the app was updated", () => {
    syncExamples();
    writeFileSync(demoA, "MY EDIT");
    // An update reinstalls the bundle: here, a demo that changed size.
    writeFileSync(join(bundle, "demoA", "project.yaml"), "A v2, longer");
    syncExamples();
    expect(readFileSync(demoA, "utf8")).toBe("A v2, longer");
  });

  it("is put back by a reset whatever the stamp says", () => {
    syncExamples();
    writeFileSync(demoA, "MY EDIT");
    mirrorDemosStamped(join(home, "workspace", EXAMPLES_WORKSPACE));
    expect(readFileSync(demoA, "utf8")).toBe("A v1");
  });
});
