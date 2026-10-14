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
      "st0: 7\ndrums: draft\nbass: soon\nkeys: 0\n",
    );
    expect(pins).toEqual({ st0: 7, drums: "draft" });
    expect(pinnedVersion(pins, "bass")).toBe(1);
    expect(stringifyLibraryPins(pins)).toBe("drums: draft\nst0: 7\n");
    expect(parseLibraryPins("- not a map")).toEqual({});
  });

  it("round-trips a manifest and says whether this st0 runs it", () => {
    const m = { name: "st0", version: 3, requires: LIBRARY_LEVEL + 1 };
    expect(parseLibraryManifest(stringifyLibraryManifest(m))).toEqual(m);
    expect(isRunnable(m)).toBe(false);
    expect(isRunnable({ ...m, requires: LIBRARY_LEVEL })).toBe(true);
    expect(parseLibraryManifest("name: st0\n")).toBeNull();
    expect(parseLibraryManifest("name: st0\nversion: 2\n")).toEqual({
      name: "st0",
      version: 2,
      requires: 1,
    });
  });
});
