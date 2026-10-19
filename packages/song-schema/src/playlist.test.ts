import { K7Document, type K7Scope } from "@studio/k7x/document";
import { describe, expect, it } from "vitest";
import {
  appendPlaylistItem,
  movePlaylistItem,
  parsePlaylist,
  playlistFromData,
  playlistPathOf,
  playlistStub,
  removePlaylistItem,
} from "./playlist.ts";

/** An edit over a whole file's text, as a caller does through wsEdit: the new text, or null when it refused. */
const edit = (text: string, fn: (doc: K7Scope) => boolean): string | null => {
  const doc = new K7Document(text);
  return fn(doc.at([])) ? doc.toString() : null;
};

describe("parsePlaylist", () => {
  it("reads a title and the items, in the file's own order", () => {
    const p = parsePlaylist(
      [
        'title("Été 2026")',
        "items([",
        '  "AC-DC/Back in Black/Hells Bells",',
        '  song("Nirvana/Nevermind/Lithium").variant("instrumental"),',
        "])",
      ].join("\n"),
    );
    expect(p?.title).toBe("Été 2026");
    // The order IS the playlist — a set list played alphabetically is a different evening.
    expect(p?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells" },
      { song: "Nirvana/Nevermind/Lithium", variant: "instrumental" },
    ]);
  });

  it("drops a line that names no song rather than inventing a ref for it", () => {
    // Coercing a malformed line would put a row on screen pointing at nothing (docs/playlistFile.md).
    const p = parsePlaylist(
      'items([["x"], { variant: "sans-voix" }, "Lithium"])\n',
    );
    expect(p?.items).toEqual([{ song: "Lithium" }]);
  });

  it("is null when the text does not read", () => {
    // A file that does not parse is one to go and FIX; an empty `items` is one to go and fill.
    expect(parsePlaylist("items([\n")).toBeNull();
  });

  it("is an empty playlist when there is no items key, not a failure", () => {
    // A file someone has started. It parses, so it is a playlist; it just has nothing in it.
    expect(parsePlaylist('title("Set")\n')).toEqual({
      title: "Set",
      items: [],
    });
    expect(parsePlaylist("")).toEqual({ items: [] });
  });

  it("round-trips its own stub, so a file it creates opens on a playlist", () => {
    const stub = playlistStub("répèt du jeudi");
    expect(stub).toBe(
      '// répèt du jeudi\ntitle("répèt du jeudi")\nitems([])\n',
    );
    expect(parsePlaylist(stub)).toEqual({ title: "répèt du jeudi", items: [] });
  });

  it("reads data already parsed by the same rules", () => {
    expect(playlistFromData({ items: ["a"] })).toEqual({
      items: [{ song: "a" }],
    });
    expect(playlistFromData(["a"])).toBeNull();
    expect(playlistFromData(null)).toBeNull();
  });
});

describe("appendPlaylistItem", () => {
  it("adds to the end of the list, a bare song when it names no variant", () => {
    const out = edit('title("Set")\nitems([\n  "Lithium",\n])\n', (d) =>
      appendPlaylistItem(d, { song: "Hells Bells" }),
    );
    expect(out).toBe(
      'title("Set")\nitems([\n  "Lithium",\n  "Hells Bells",\n])\n',
    );
  });

  it("fills the stub's empty list", () => {
    const out = edit(playlistStub("Set"), (d) =>
      appendPlaylistItem(d, { song: "Lithium" }),
    ) as string;
    expect(out.startsWith("// Set\n")).toBe(true);
    expect(parsePlaylist(out)?.items).toEqual([{ song: "Lithium" }]);
  });

  it("writes the variant beside the song", () => {
    const out = edit('items(["Lithium"])\n', (d) =>
      appendPlaylistItem(d, { song: "Nevermind/Lithium", variant: "inst" }),
    ) as string;
    expect(parsePlaylist(out)?.items[1]).toEqual({
      song: "Nevermind/Lithium",
      variant: "inst",
    });
  });

  it("keeps the comments and the order", () => {
    const before = [
      "// la répèt du jeudi",
      'title("Répèt")',
      "items([",
      "  // on ouvre là-dessus",
      '  "Hells Bells",',
      '  "Lithium",',
      "])",
      "",
    ].join("\n");
    const out = edit(before, (d) =>
      appendPlaylistItem(d, { song: "Rock 'n' Roll: Part 2" }),
    ) as string;
    expect(out).toContain("// la répèt du jeudi");
    expect(out).toContain("  // on ouvre là-dessus");
    expect(parsePlaylist(out)?.items.map((i) => i.song)).toEqual([
      "Hells Bells",
      "Lithium",
      "Rock 'n' Roll: Part 2",
    ]);
  });

  it("adds the key when the file has none", () => {
    const out = edit('title("Set")\n', (d) =>
      appendPlaylistItem(d, { song: "Lithium" }),
    ) as string;
    expect(parsePlaylist(out)).toEqual({
      title: "Set",
      items: [{ song: "Lithium" }],
    });
  });

  it("refuses an `items` that is no list rather than guessing", () => {
    expect(
      edit('items("nonsense")\n', (d) => appendPlaylistItem(d, { song: "x" })),
    ).toBeNull();
  });
});

describe("removing and moving a line", () => {
  const SET =
    'items([\n  "a",\n  // the second\n  song("b").variant("v"),\n  "c",\n])\n';

  it("drops one line by its position, and refuses one that is not there", () => {
    const out = edit(SET, (d) => removePlaylistItem(d, 0)) as string;
    expect(parsePlaylist(out)?.items.map((i) => i.song)).toEqual(["b", "c"]);
    expect(edit(SET, (d) => removePlaylistItem(d, 3))).toBeNull();
    expect(edit('title("x")\n', (d) => removePlaylistItem(d, 0))).toBeNull();
  });

  it("moves a line with its comment", () => {
    const out = edit(SET, (d) => movePlaylistItem(d, 1, 2)) as string;
    expect(parsePlaylist(out)?.items.map((i) => i.song)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(out).toContain("// the second");
    expect(edit(SET, (d) => movePlaylistItem(d, 0, 5))).toBeNull();
  });
});

describe("playlistPathOf", () => {
  it("turns a name into the workspace path holding it", () => {
    expect(playlistPathOf("ete-2026")).toBe("_playlists/ete-2026.k7x");
  });

  it("keeps subfolders — `_playlists/` nests", () => {
    expect(playlistPathOf("live/repet")).toBe("_playlists/live/repet.k7x");
  });

  it("keeps an extension somebody wrote out", () => {
    expect(playlistPathOf("set.k7x")).toBe("_playlists/set.k7x");
  });

  it("trims what a hand-edited value carries", () => {
    expect(playlistPathOf("  ete-2026  ")).toBe("_playlists/ete-2026.k7x");
    expect(playlistPathOf("/live/repet/")).toBe("_playlists/live/repet.k7x");
  });

  // Null and not a throw, since the value comes out of a file somebody typed (docs/playlistFile.md).
  it("answers null for a name that would leave the folder", () => {
    expect(playlistPathOf("../secrets")).toBeNull();
    expect(playlistPathOf("live/../../out")).toBeNull();
    expect(playlistPathOf("")).toBeNull();
    expect(playlistPathOf("   ")).toBeNull();
    expect(playlistPathOf("a//b")).toBeNull();
  });
});
