// The library browser's catalogue: one level per folder, and a search that looks at the
// folders too.
//
// Nesting is the whole point of this component. These folders arrive from the outside — a
// NAM pack is a folder per amp, an IR pack a folder per cabinet then per mic — and the
// flat <select> this replaced ground the folder into the filename and listed 300 entries
// in one alphabetical scroll.

import { describe, expect, it } from "vitest";
import { buildLibraryTree, searchLibrary } from "./LibraryPicker";

const FILES = [
  "nam/Marshall/JCM800/lead.nam",
  "nam/Marshall/JCM800/clean.nam",
  "nam/Marshall/plexi.nam",
  "nam/Two-Rock/overdrive.nam",
  "nam/flat.nam",
  "ir/cab/v30.wav", // a different kind — must never reach a `nam` widget
];

describe("the library tree", () => {
  it("nests one level per folder, dropping the kind prefix", () => {
    // The widget already says which library it browses, so "nam/" on every row is width
    // spent saying nothing. Folders sort before files: a folder is a place to go, a file
    // is the answer, and interleaving them alphabetically buries the structure.
    const t = buildLibraryTree(FILES, "nam");
    expect(t.map((n) => n.label)).toEqual(["Marshall", "Two-Rock", "flat"]);
    const marshall = t[0].children ?? [];
    expect(marshall.map((n) => n.label)).toEqual(["JCM800", "plexi"]);
    expect((marshall[0].children ?? []).map((n) => n.label)).toEqual([
      "clean",
      "lead",
    ]);
  });

  it("hands back the full library-relative path, not the label", () => {
    // What the module stores is the path; the label is only what you read.
    const t = buildLibraryTree(FILES, "nam");
    expect(t[0].children?.[0].children?.[0].entry).toBe(
      "nam/Marshall/JCM800/clean.nam",
    );
  });

  it("offers only its own kind", () => {
    expect(JSON.stringify(buildLibraryTree(FILES, "nam"))).not.toContain("v30");
    expect(buildLibraryTree(FILES, "ir").map((n) => n.label)).toEqual(["cab"]);
  });

  it("searches the file name AND its folders", () => {
    // The folder is half of what anyone remembers about a profile.
    expect(searchLibrary(FILES, "nam", "lead")[0]?.entry).toBe(
      "nam/Marshall/JCM800/lead.nam",
    );
    expect(searchLibrary(FILES, "nam", "jcm")[0]?.entry).toContain("JCM800");
    expect(searchLibrary(FILES, "nam", "v30")).toEqual([]); // wrong kind
  });

  it("hints the folder, so same-named profiles stay apart", () => {
    expect(searchLibrary(FILES, "nam", "clean")[0]?.hint).toBe(
      "Marshall/JCM800",
    );
  });

  it("has nothing to show for an empty query — the tree is for browsing", () => {
    expect(searchLibrary(FILES, "nam", "   ")).toEqual([]);
  });
});
