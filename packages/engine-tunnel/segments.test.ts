// Tests for the segment guard: the same cases as engine/k7-supervisor/tests/PathMap_test.cpp, so the
// TypeScript agent refuses what the native one refuses.

import { describe, expect, it } from "vitest";
import { PathMap, type RemoteFiles, SyncLedger } from "./pathMap.ts";
import { safeSegment } from "./segments.ts";

const refused: [string, string][] = [
  ["", "empty"],
  [".", "the root itself"],
  ["..", "the parent"],
  ["...", "dots alone"],
  [".. ", "dots and a space, which Windows trims to .."],
  ["..\\..\\x", "a backslash"],
  ["C:", "a drive"],
  ["C:\\x", "a drive path"],
  ["\\Windows", "a rooted backslash"],
  ["a/b", "a slash"],
  ["a\tb", "a control character"],
  ["a\0b", "a NUL"],
  ["a\x7fb", "DEL"],
  ["CON", "a device"],
  ["con", "a device, lower case"],
  ["Prn.txt", "a device with an extension"],
  ["aux.wav", "a device with an extension"],
  ["nul.tar.gz", "a device with two extensions"],
  ["COM1", "a numbered device"],
  ["com9.log", "a numbered device with an extension"],
  ["LPT3", "a printer"],
  ["lpt0", "a printer, lower case"],
  ["CONIN$", "the console's input"],
  ["COM\u00b9", "a superscript device number"],
  ["AUX .wav", "a device with a space before the dot"],
];

const accepted = [
  "clip.wav",
  ".hidden",
  "CONSOLE",
  "console.wav",
  "COM10",
  "LPT",
  "comic.wav",
  "nullable",
  "aux1.wav",
  "my-con.wav",
];

describe("safeSegment", () => {
  it.each(refused)("refuses %j (%s)", (seg) => {
    expect(safeSegment(seg, false)).toBe(false);
    expect(safeSegment(seg, true)).toBe(false);
  });

  it.each(accepted)("accepts %j", (seg) => {
    expect(safeSegment(seg, false)).toBe(true);
  });

  // Windows trims a trailing dot or space, so `a.` and `a` would be one file there.
  it("refuses a trailing dot or space on Windows only", () => {
    for (const seg of ["clip.", "clip "]) {
      expect(safeSegment(seg, true)).toBe(false);
      expect(safeSegment(seg, false)).toBe(true);
    }
  });
});

describe("PathMap.toLocal", () => {
  const none: RemoteFiles = {
    stat: async () => [],
    download: async () => {},
    upload: async () => {
      throw new Error("unused");
    },
  };
  const map = new PathMap(
    [{ remote: "/srv/ws", local: "/cache/ws", writable: true }],
    none,
    new SyncLedger(),
  );

  it("refuses a server path whose segment would not stay a file under the root", () => {
    for (const bad of [
      "../x",
      "a/../../x",
      "a/./b",
      "a//b",
      "a/",
      "nul.wav",
      "C:x",
      "a\\..\\x",
    ])
      expect(map.toLocal(`/srv/ws/${bad}`), bad).toBeNull();
  });

  it("maps a plain one", () => {
    expect(map.toLocal("/srv/ws/songs/clip.wav")).not.toBeNull();
  });
});
