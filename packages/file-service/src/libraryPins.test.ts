// libraryPins.test.ts — a workspace's pins are written once: what it already hears, the newest
// runnable version for a new one, the draft for an admin's, and never again after that.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LIBRARY_MANIFEST,
  LIBRARY_PINS_FILE,
  parseLibraryPins,
  stringifyLibraryManifest,
} from "@studio/song-schema/libraryVersions";
import { LEGACY_LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersionsLegacy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLibraryPins } from "./libraryPins.ts";

const env = process.env.STUDIO_LIBRARIES_HOME;
let home: string;
let ws: string;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), "pins-"));
  home = join(tmp, "libraries");
  ws = join(tmp, "ws");
  mkdirSync(ws);
  for (const [v, requires] of [
    [1, 1],
    [2, 1],
    [3, 99],
  ] as const) {
    mkdirSync(join(home, "k7-core", String(v)), { recursive: true });
    writeFileSync(
      join(home, "k7-core", String(v), LIBRARY_MANIFEST),
      stringifyLibraryManifest({ name: "k7-core", version: v, requires }),
    );
  }
  process.env.STUDIO_LIBRARIES_HOME = home;
});

afterEach(() => {
  process.env.STUDIO_LIBRARIES_HOME = env;
});

const pins = () =>
  parseLibraryPins(readFileSync(join(ws, LIBRARY_PINS_FILE), "utf8"));

describe("ensureLibraryPins", () => {
  it("pins an existing workspace at version 1, what it already hears", () => {
    expect(ensureLibraryPins(ws, { fresh: false, admin: false })).toEqual({
      "k7-core": 1,
    });
    expect(pins()).toEqual({ "k7-core": 1 });
  });

  it("pins a new workspace at the newest version this k7 runs, skipping one that needs a higher level", () => {
    expect(ensureLibraryPins(ws, { fresh: true, admin: false })).toEqual({
      "k7-core": 2,
    });
  });

  it("pins an admin's workspace at the draft, and never rewrites pins it already has", () => {
    expect(ensureLibraryPins(ws, { fresh: false, admin: true })).toEqual({
      "k7-core": "draft",
    });
    expect(ensureLibraryPins(ws, { fresh: true, admin: false })).toBeNull();
    expect(pins()).toEqual({ "k7-core": "draft" });
  });

  it("upgrades pins written before k7x once, keeping what they said", () => {
    writeFileSync(join(ws, LEGACY_LIBRARY_PINS_FILE), "k7-core: 2\n");
    expect(ensureLibraryPins(ws, { fresh: true, admin: true })).toBeNull();
    expect(pins()).toEqual({ "k7-core": 2 });
    expect(existsSync(join(ws, LEGACY_LIBRARY_PINS_FILE))).toBe(false);
  });
});
