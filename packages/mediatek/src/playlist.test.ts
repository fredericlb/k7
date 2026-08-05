import { describe, expect, it } from "vitest";
import { parsePlaylist, playlistStub } from "./playlist.ts";

describe("parsePlaylist", () => {
  it("reads a title and the items, in the file's own order", () => {
    const p = parsePlaylist(
      [
        "title: Été 2026",
        "items:",
        "  - AC-DC/Back in Black/Hells Bells",
        "  - song: Nirvana/Nevermind/Lithium",
        "    variant: instrumental",
      ].join("\n"),
    );
    expect(p?.title).toBe("Été 2026");
    // The order IS the playlist — a set list played alphabetically is a different evening.
    expect(p?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells" },
      { song: "Nirvana/Nevermind/Lithium", variant: "instrumental" },
    ]);
  });

  it("takes a bare string as the song, which is what anyone actually types", () => {
    expect(parsePlaylist("items:\n  - Hells Bells\n")?.items).toEqual([
      { song: "Hells Bells" },
    ]);
  });

  it("drops a line that names no song rather than inventing a ref for it", () => {
    // `- [x]` and `- {variant: foo}` are malformed lines. Coercing either would put a row on
    // screen pointing at something nobody can go and look at.
    const p = parsePlaylist(
      ["items:", "  - [x]", "  - variant: sans-voix", "  - Lithium"].join("\n"),
    );
    expect(p?.items).toEqual([{ song: "Lithium" }]);
  });

  it("is null when the text is not a playlist at all", () => {
    // Null and not an empty playlist: a file that does not parse is one to go and FIX, and an
    // empty `items:` is one to go and fill. The surface says those differently.
    expect(parsePlaylist("items: [\n")).toBeNull();
    expect(parsePlaylist("- just\n- a list\n")).toBeNull();
    expect(parsePlaylist("")).toBeNull();
  });

  it("is an empty playlist when there is no items key, not a failure", () => {
    // A file someone has started. It parses, so it is a playlist; it just has nothing in it.
    expect(parsePlaylist("title: Set\n")).toEqual({ title: "Set", items: [] });
  });

  it("round-trips its own stub, so a file it creates opens on a playlist", () => {
    const p = parsePlaylist(playlistStub("répèt du jeudi"));
    expect(p).toEqual({ title: "répèt du jeudi", items: [] });
  });
});
