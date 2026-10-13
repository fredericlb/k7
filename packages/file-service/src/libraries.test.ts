// libraries.test.ts — an admin writes the hub's folder of each library in place; anyone else reads it only.

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isLibraryEditable,
  libraryRoot,
  setLibraryOverlays,
} from "@studio/song/sharedFolders";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refreshLibraries } from "./libraries.ts";
import { Workspace } from "./workspace.ts";

const env = {
  home: process.env.STUDIO_LIBRARIES_HOME,
  hub: process.env.STUDIO_HUB_URL,
};
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "libs-"));
  mkdirSync(join(home, "st0"));
  mkdirSync(join(home, ".sync-replica"));
  process.env.STUDIO_LIBRARIES_HOME = home;
  delete process.env.STUDIO_HUB_URL;
});

afterEach(() => {
  setLibraryOverlays([]);
  process.env.STUDIO_LIBRARIES_HOME = env.home;
  if (env.hub) process.env.STUDIO_HUB_URL = env.hub;
});

describe("refreshLibraries", () => {
  it("opens every library on disk for writing, in place, to an admin", async () => {
    await refreshLibraries(true);
    expect(isLibraryEditable("st0")).toBe(true);
    expect(libraryRoot("st0")).toBe(join(home, "st0"));
  });

  it("opens a versioned library's DRAFT to an admin, and never one of its versions", async () => {
    mkdirSync(join(home, "st0", "1"));
    mkdirSync(join(home, "st0", "draft"));
    await refreshLibraries(true);
    expect(libraryRoot("st0")).toBe(join(home, "st0", "draft"));
    const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
    expect(() =>
      ws.assertLibraryWritable(join(home, "st0", "1", "modules", "x")),
    ).toThrow(/published version never changes/);
    expect(() =>
      ws.assertLibraryWritable(join(home, "st0", "draft", "modules", "x")),
    ).not.toThrow();
  });

  it("leaves them read-only to anyone else", async () => {
    await refreshLibraries(true);
    await refreshLibraries(false);
    expect(isLibraryEditable("st0")).toBe(false);
    expect(libraryRoot("st0")).toBe(join(home, "st0"));
  });
});
