// paths.test.ts — the shared table every confinement in the tree leans on: one row per trap.

import { describe, expect, it } from "vitest";
import {
  assertPlainSegments,
  climbsOut,
  isBelow,
  isPlainSegment,
  isWithin,
  plainSegments,
} from "./paths.ts";

// [root, path, isWithin, isBelow]
const WITHIN: [string, string, boolean, boolean][] = [
  ["/data/ws", "/data/ws", true, false],
  ["/data/ws", "/data/ws/a.yaml", true, true],
  ["/data/ws", "/data/ws/a/b/c", true, true],
  ["/data/ws/", "/data/ws/a", true, true],
  ["/", "/etc/passwd", true, true],
  // The separator is the point: a sibling sharing the prefix is outside.
  ["/data/ws", "/data/ws-old/a", false, false],
  ["/data/ws", "/data/wsx", false, false],
  ["/data/ws", "/data", false, false],
  ["/data/ws", "/other", false, false],
  // On a POSIX root a backslash is a name character, not a separator.
  ["/data/ws", "/data/ws\\..\\x", false, false],
  ["/data", "/data\\x", false, false],
  // A Windows root: both separators, and case folded as NTFS folds it.
  ["C:\\data\\ws", "C:\\data\\ws", true, false],
  ["C:\\data\\ws", "C:\\data\\ws\\a", true, true],
  ["C:\\data\\ws", "C:\\data\\ws/a", true, true],
  ["C:\\data\\ws", "c:\\DATA\\WS\\a", true, true],
  ["C:\\data\\ws", "C:\\data\\ws-old\\a", false, false],
  ["C:\\data\\ws", "D:\\data\\ws\\a", false, false],
  ["C:\\", "C:\\x", true, true],
  ["\\\\host\\share", "\\\\host\\share\\a", true, true],
  ["", "/a", false, false],
  ["/a", "", false, false],
];

describe("isWithin / isBelow", () => {
  it.each(WITHIN)("%s ∋ %s", (root, path, within, below) => {
    expect(isWithin(root, path)).toBe(within);
    expect(isBelow(root, path)).toBe(below);
  });
});

describe("climbsOut", () => {
  it.each([
    ["..", true],
    ["../x", true],
    ["..\\x", true],
    ["/abs", true],
    ["D:\\x", true],
    ["\\\\host\\share", true],
    ["", false],
    ["a/b", false],
    ["..foo", false],
    ["..foo/bar", false],
    ["a/../b", false],
  ])("%s → %s", (rel, out) => expect(climbsOut(rel)).toBe(out));
});

describe("segments", () => {
  it("names a child only with a plain segment", () => {
    for (const s of ["a", "..a", "a..", "...", ".hidden", "a b"])
      expect(isPlainSegment(s)).toBe(true);
    for (const s of ["", ".", ".."]) expect(isPlainSegment(s)).toBe(false);
  });

  it.each([
    ["a/b/c.yaml", "/", ["a", "b", "c.yaml"]],
    ["a/../b", "/", null],
    ["./a", "/", null],
    ["a//b", "/", null],
    ["/a", "/", null],
    ["a/", "/", null],
    ["a\\..\\b", "/", ["a\\..\\b"]],
    ["a\\..\\b", /[\\/]+/, null],
    ["a\\b/c", /[\\/]+/, ["a", "b", "c"]],
  ] as const)("%s split on %s", (path, sep, out) =>
    expect(plainSegments(path, sep)).toEqual(out),
  );

  it("asserts by throwing with the path named", () => {
    expect(assertPlainSegments("a/b")).toEqual(["a", "b"]);
    expect(() => assertPlainSegments("a/../b")).toThrow("a/../b");
  });
});
