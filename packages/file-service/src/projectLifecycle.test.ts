// The demos' workspace takes no new project, whichever way one would arrive — create, import, copy.
// A project the bundle does not hold would sit among folders mirrored on every start.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { EXAMPLES_WORKSPACE } from "@studio/web-protocol/projects";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyProjectInto,
  createProjectIn,
  importProjectBytes,
  type LifecycleHost,
} from "./projectLifecycle.ts";

let work: string;

const hostAt = (name: string): LifecycleHost => {
  const root = join(work, name);
  mkdirSync(root, { recursive: true });
  return {
    root,
    safePath: (rel) => join(root, rel),
    toRel: (abs) => relative(root, abs),
  };
};

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "td-lifecycle-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("the Examples workspace", () => {
  it("refuses a new project", () => {
    const host = hostAt(EXAMPLES_WORKSPACE);
    expect(() => createProjectIn(host, "arrangement", "mine.k7")).toThrow(
      /takes no new project/,
    );
    expect(existsSync(join(host.root, "mine.k7"))).toBe(false);
  });

  it("refuses a dropped import", () => {
    const host = hostAt(EXAMPLES_WORKSPACE);
    expect(() =>
      importProjectBytes(host, "x.dawproject", new Uint8Array(), "x.k7"),
    ).toThrow(/takes no new project/);
  });

  it("refuses a copy into it", async () => {
    const src = hostAt("songs");
    mkdirSync(join(src.root, "a.k7"));
    await expect(
      copyProjectInto(
        hostAt(EXAMPLES_WORKSPACE),
        join(src.root, "a.k7"),
        "a.k7",
        () => false,
      ),
    ).rejects.toThrow(/takes no new project/);
  });

  it("leaves any other workspace free to create", () => {
    const host = hostAt("songs");
    expect(createProjectIn(host, "arrangement", "mine.k7").project).toBe(
      "mine.k7",
    );
  });
});
