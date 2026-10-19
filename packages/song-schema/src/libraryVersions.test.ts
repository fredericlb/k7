import { describe, expect, it } from "vitest";
import {
  isRunnable,
  LIBRARY_LEVEL,
  parseLibraryManifest,
  parseLibraryPins,
  pinnedVersion,
  stringifyLibraryManifest,
  stringifyLibraryPins,
  versionOfDir,
} from "./libraryVersions";
import {
  parseLegacyLibraryManifest,
  parseLegacyLibraryPins,
} from "./libraryVersionsLegacy";

describe("libraryVersions", () => {
  it("knows a version folder from any other", () => {
    expect(versionOfDir("1")).toBe(1);
    expect(versionOfDir("12")).toBe(12);
    expect(versionOfDir("draft")).toBe("draft");
    expect(versionOfDir("01")).toBeNull();
    expect(versionOfDir("modules")).toBeNull();
  });

  it("reads pins, dropping what is no version, and writes them in name order", () => {
    const pins = parseLibraryPins(
      '"k7-core"(7)\ndrums("draft")\nbass("soon")\nkeys(0)\n',
    );
    expect(pins).toEqual({ "k7-core": 7, drums: "draft" });
    expect(pinnedVersion(pins, "bass")).toBe(1);
    expect(stringifyLibraryPins(pins)).toBe('drums("draft")\nk7-core(7)\n');
    expect(parseLibraryPins(stringifyLibraryPins(pins))).toEqual(pins);
    expect(parseLibraryPins("drums(")).toEqual({});
  });

  it("round-trips a manifest and says whether this k7 runs it", () => {
    const m = { name: "k7-core", version: 3, requires: LIBRARY_LEVEL + 1 };
    expect(parseLibraryManifest(stringifyLibraryManifest(m))).toEqual(m);
    expect(isRunnable(m)).toBe(false);
    expect(isRunnable({ ...m, requires: LIBRARY_LEVEL })).toBe(true);
    expect(parseLibraryManifest('name("k7-core")\n')).toBeNull();
    expect(parseLibraryManifest('name("k7-core")\nversion(2)\n')).toEqual({
      name: "k7-core",
      version: 2,
      requires: 1,
    });
  });

  it("keeps a manifest's notes across lines", () => {
    const m = { name: "x", version: 1, requires: 1, notes: "one\ntwo" };
    expect(parseLibraryManifest(stringifyLibraryManifest(m))).toEqual(m);
  });
});

describe("a legacy YAML pins or manifest file", () => {
  it("reads by the same rules, for its owner to write it again as k7x", () => {
    expect(
      parseLegacyLibraryPins("k7-core: 7\ndrums: draft\nbass: soon\n"),
    ).toEqual({ "k7-core": 7, drums: "draft" });
    expect(parseLegacyLibraryPins("- not a map")).toEqual({});
    expect(parseLegacyLibraryPins("a: [\n")).toEqual({});
    expect(parseLegacyLibraryManifest("name: k7-core\nversion: 2\n")).toEqual({
      name: "k7-core",
      version: 2,
      requires: 1,
    });
    expect(parseLegacyLibraryManifest("name: k7-core\n")).toBeNull();
  });
});
