// libraries.test.ts — an admin writes the hub's folder of each library in place; anyone else reads it only.

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountLibraryHome,
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
  mkdirSync(join(home, "k7-core"));
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
    expect(isLibraryEditable("k7-core")).toBe(true);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core"));
  });

  it("opens a versioned library's DRAFT to an admin, and never one of its versions", async () => {
    mkdirSync(join(home, "k7-core", "1"));
    mkdirSync(join(home, "k7-core", "draft"));
    await refreshLibraries(true);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core", "draft"));
    const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
    expect(() =>
      ws.assertLibraryWritable(join(home, "k7-core", "1", "modules", "x")),
    ).toThrow(/published version never changes/);
    expect(() =>
      ws.assertLibraryWritable(join(home, "k7-core", "draft", "modules", "x")),
    ).not.toThrow();
  });

  it("answers the ACCOUNT's library at _libraries/account, its own to write, never outside it", () => {
    const studioHome0 = process.env.STUDIO_HOME;
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "acct-"));
    try {
      const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
      const at = ws.mediaPath("_libraries/account/modules/audio/x");
      expect(at).toBe(join(accountLibraryHome(), "modules", "audio", "x"));
      expect(() => ws.assertLibraryWritable(at)).not.toThrow();
      expect(() => ws.mediaPath("_libraries/account/../../etc")).toThrow();
    } finally {
      if (studioHome0 === undefined) delete process.env.STUDIO_HOME;
      else process.env.STUDIO_HOME = studioHome0;
    }
  });

  it("leaves them read-only to anyone else", async () => {
    await refreshLibraries(true);
    await refreshLibraries(false);
    expect(isLibraryEditable("k7-core")).toBe(false);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core"));
  });
});
