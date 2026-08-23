// What a module-stamp SCOPE promises, and the one thing that made hoisting one backfire.
//
// The stamp is a directory walk — 329 readdirs and 419 stats on a real project, ~19 ms — and a
// scope exists so a caller that makes several loader calls pays it once. A nested scope for the
// same project therefore has to KEEP the enclosing one; opening a fresh one walked again, so
// wrapping a route that already contained two scoped calls made it slower, not faster.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules, withModuleStamp } from "./loader";

let root = "";
let dir = "";

const module_ = (at: string, name: string): void => {
  mkdirSync(join(at, "modules", "audio", name), { recursive: true });
  writeFileSync(
    join(at, "modules", "audio", name, "module.yaml"),
    `# ${name}\nplugin:\n  type: internal\n  name: Mixer\n`,
    "utf8",
  );
};

const project = (name: string): string => {
  const at = join(root, name);
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, "project.yaml"), "project:\n  name: t\n", "utf8");
  module_(at, "reverb");
  return at;
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "module-stamp-"));
  dir = project("one.st0");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("withModuleStamp", () => {
  it("reads the folders when there is no scope", () => {
    expect(Object.keys(loadModules(dir))).toContain("reverb");
  });

  // Inside a scope the module folders are held still, and a nested call may not re-check.
  it("keeps ONE stamp across a scope nested for the same project", () => {
    const seen = withModuleStamp(dir, () => {
      const before = Object.keys(loadModules(dir));
      module_(dir, "delay"); // a module appears mid-derivation
      const after = withModuleStamp(dir, () => Object.keys(loadModules(dir)));
      return { before, after };
    });
    expect(seen.after).toEqual(seen.before);
    expect(seen.after).not.toContain("delay");
  });

  // …and per PROJECT: a library chain built while a project is open is exactly that shape.
  it("gives a scope for another project its own stamp", () => {
    const other = project("two.st0");
    module_(other, "chorus");
    const seen = withModuleStamp(dir, () =>
      withModuleStamp(other, () => Object.keys(loadModules(other))),
    );
    expect(seen).toContain("chorus");
  });

  // The outer scope survives the inner one: restoring, not clearing.
  it("is still inside the outer scope after an inner one returns", () => {
    const other = project("two.st0");
    const seen = withModuleStamp(dir, () => {
      const before = Object.keys(loadModules(dir));
      withModuleStamp(other, () => loadModules(other));
      module_(dir, "delay");
      return { before, after: Object.keys(loadModules(dir)) };
    });
    expect(seen.after).toEqual(seen.before);
  });
});
