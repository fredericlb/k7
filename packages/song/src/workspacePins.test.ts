// workspacePins.test.ts — a workspace's pins read from `_library-pins.k7x`, a legacy YAML one upgraded once and only when it reads.

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
import { LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersions";
import { LEGACY_LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersionsLegacy";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspacePins } from "./sharedFolders";

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "ws-pins-"));
  mkdirSync(join(ws, "song.k7"));
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("a workspace's pins", () => {
  it("upgrades a legacy pins file once, from a folder inside the workspace", () => {
    writeFileSync(join(ws, LEGACY_LIBRARY_PINS_FILE), "k7-core: 2\n");
    expect(workspacePins(join(ws, "song.k7"))).toEqual({ "k7-core": 2 });
    expect(existsSync(join(ws, LEGACY_LIBRARY_PINS_FILE))).toBe(false);
    expect(existsSync(join(ws, LIBRARY_PINS_FILE))).toBe(true);
  });

  it("leaves a legacy pins file that does not read where it is, for the user to fix", () => {
    writeFileSync(join(ws, LEGACY_LIBRARY_PINS_FILE), "k7-core: [2\n");
    expect(workspacePins(ws)).toEqual({});
    expect(readFileSync(join(ws, LEGACY_LIBRARY_PINS_FILE), "utf8")).toBe(
      "k7-core: [2\n",
    );
    expect(existsSync(join(ws, LIBRARY_PINS_FILE))).toBe(false);
  });
});
