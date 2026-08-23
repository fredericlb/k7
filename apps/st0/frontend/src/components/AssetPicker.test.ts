// The asset browser's catalogue: one level per folder, and a search that looks at the folders
// too.
//
// Nesting is the whole point of this component. These folders arrive from the outside — a NAM
// pack is a folder per amp — and the flat <select> this replaced ground the folder into the
// filename and listed 300 entries in one alphabetical scroll.
//
// The paths are `assets/`-relative, which is what `listModuleAssets` returns. They used to be
// prefixed with a library kind (`nam/…`) and were filtered on it; module assets carry no such
// prefix, so that filter matched nothing at all — see the guitar case below.

import { describe, expect, it } from "vitest";
import { buildAssetTree, searchAssets } from "./AssetPicker";

const FILES = [
  "Marshall/JCM800/lead.nam",
  "Marshall/JCM800/clean.nam",
  "Marshall/plexi.nam",
  "Two-Rock/overdrive.nam",
  "flat.nam",
  "cab/v30.wav", // not a `.nam` — must never reach a widget bound to `nam`
  "big.onnx", // another file-valued param's material, in the same folder
];

describe("the asset tree", () => {
  it("nests one level per folder", () => {
    // Folders sort before files: a folder is a place to go and a file is the answer, and interleaving them buries the structure.
    const t = buildAssetTree(FILES, "nam");
    expect(t.map((n) => n.label)).toEqual(["Marshall", "Two-Rock", "flat"]);
    const marshall = t[0].children ?? [];
    expect(marshall.map((n) => n.label)).toEqual(["JCM800", "plexi"]);
    expect((marshall[0].children ?? []).map((n) => n.label)).toEqual([
      "clean",
      "lead",
    ]);
  });

  it("hands back the full assets-relative path, not the label", () => {
    // What the module stores is the path; the label is only what you read.
    const t = buildAssetTree(FILES, "nam");
    expect(t[0].children?.[0].children?.[0].entry).toBe(
      "Marshall/JCM800/clean.nam",
    );
  });

  it("offers only what the bound param can load", () => {
    // `nam` loads `.nam`. The wav and the onnx sit in the same assets/ and are not choices here.
    const json = JSON.stringify(buildAssetTree(FILES, "nam"));
    expect(json).not.toContain("v30");
    expect(json).not.toContain("big");
    expect(buildAssetTree(FILES, "onnx").map((n) => n.label)).toEqual(["big"]);
  });

  it("lists a real module's assets, which carry NO library prefix", () => {
    // The médiathèque's amp folder as listModuleAssets returns it: filtering on a `nam/` prefix opened the one module built to be picked from empty.
    const guitar = [
      "fender super reverb/Fender Super Reverb_ EQ Flat, Volume 3, sm57.nam",
      "roland jc 120b/Roland JC 120B Jazz Chorus_ Bright On, SM57.nam",
      "two rocks/DELUXE REVERB OXFORD - BIG.wav",
    ];
    const t = buildAssetTree(guitar, "nam");
    expect(t.map((n) => n.label)).toEqual([
      "fender super reverb",
      "roland jc 120b",
    ]);
    expect(t[0].children).toHaveLength(1);
  });

  it("searches the file name AND its folders", () => {
    // The folder is half of what anyone remembers about a profile.
    expect(searchAssets(FILES, "nam", "lead")[0]?.entry).toBe(
      "Marshall/JCM800/lead.nam",
    );
    expect(searchAssets(FILES, "nam", "jcm")[0]?.entry).toContain("JCM800");
    expect(searchAssets(FILES, "nam", "v30")).toEqual([]); // wrong extension
  });

  it("hints the folder, so same-named profiles stay apart", () => {
    expect(searchAssets(FILES, "nam", "clean")[0]?.hint).toBe(
      "Marshall/JCM800",
    );
  });

  it("has nothing to show for an empty query — the tree is for browsing", () => {
    expect(searchAssets(FILES, "nam", "   ")).toEqual([]);
  });
});
