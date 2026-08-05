import { describe, expect, it } from "vitest";
import {
  appendPlaylistItem,
  parsePlaylist,
  playlistStub,
  yamlScalar,
} from "./playlist.ts";

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

describe("yamlScalar", () => {
  it("leaves a song path alone — spaces, ampersands and parentheses and all", () => {
    // These come out of `segment()` and are the ordinary case; quoting them would put two
    // conventions in one hand-edited file.
    for (const plain of [
      "AC-DC/Back in Black/Hells Bells",
      "Simon & Garfunkel/Bookends/America",
      "Nirvana/Unplugged/The Man Who Sold The World (Live)",
      "instrumental",
    ])
      expect(yamlScalar(plain)).toBe(plain);
  });

  it("quotes what would stop being a string", () => {
    expect(yamlScalar("- not a list")).toBe("'- not a list'");
    expect(yamlScalar("Artist: Album")).toBe("'Artist: Album'"); // else a mapping
    expect(yamlScalar("*star")).toBe("'*star'"); // else an alias
    expect(yamlScalar("track #3")).toBe("'track #3'"); // else a comment
    expect(yamlScalar(" padded ")).toBe("' padded '");
    expect(yamlScalar("")).toBe("''");
  });

  it("quotes what YAML would read as something other than a string", () => {
    // A morceau called "No" is a title, not `false`.
    expect(yamlScalar("No")).toBe("'No'");
    expect(yamlScalar("null")).toBe("'null'");
    expect(yamlScalar("42")).toBe("'42'");
  });

  it("doubles a quote rather than escaping it", () => {
    expect(yamlScalar("Rock 'n' Roll: Part 2")).toBe(
      "'Rock ''n'' Roll: Part 2'",
    );
  });
});

describe("appendPlaylistItem", () => {
  it("adds to the end of an existing block, keeping the file's own indentation", () => {
    const out = appendPlaylistItem("title: Set\nitems:\n    - Lithium\n", {
      song: "Hells Bells",
    });
    // Four spaces, because that is what the file was already using.
    expect(out).toBe("title: Set\nitems:\n    - Lithium\n    - Hells Bells\n");
  });

  it("turns the stub's empty flow into a block", () => {
    expect(appendPlaylistItem(playlistStub("Set"), { song: "Lithium" })).toBe(
      "# Set\ntitle: Set\nitems:\n  - Lithium\n",
    );
  });

  it("writes a mapping when the line names a variant, aligned past the dash", () => {
    const out = appendPlaylistItem("items:\n  - Lithium\n", {
      song: "Nevermind/Lithium",
      variant: "instrumental",
    }) as string;
    expect(out).toBe(
      "items:\n  - Lithium\n  - song: Nevermind/Lithium\n    variant: instrumental\n",
    );
    expect(parsePlaylist(out)?.items[1]).toEqual({
      song: "Nevermind/Lithium",
      variant: "instrumental",
    });
  });

  it("keeps the comments and the order — the whole reason this is text", () => {
    const before = [
      "# la répèt du jeudi",
      "title: Répèt",
      "items:",
      "  # on ouvre là-dessus",
      "  - Hells Bells",
      "  - Lithium",
      "",
    ].join("\n");
    const out = appendPlaylistItem(before, { song: "America" }) as string;
    expect(out).toContain("# la répèt du jeudi");
    expect(out).toContain("  # on ouvre là-dessus");
    expect(parsePlaylist(out)?.items.map((i) => i.song)).toEqual([
      "Hells Bells",
      "Lithium",
      "America",
    ]);
  });

  it("adds the key when the file has none, and to a file that is only a title", () => {
    expect(appendPlaylistItem("title: Set\n", { song: "Lithium" })).toBe(
      "title: Set\nitems:\n  - Lithium\n",
    );
    // …and gives a file with no trailing newline one, rather than joining two lines.
    expect(appendPlaylistItem("title: Set", { song: "Lithium" })).toBe(
      "title: Set\nitems:\n  - Lithium\n",
    );
  });

  it("adds under a key that has nothing under it yet", () => {
    expect(appendPlaylistItem("items:\n", { song: "Lithium" })).toBe(
      "items:\n  - Lithium\n",
    );
  });

  it("extends a one-line flow list in its own notation", () => {
    // Converting it to a block would rewrite a line nobody asked us to touch.
    expect(
      appendPlaylistItem("items: [Lithium]\n", { song: "Hells Bells" }),
    ).toBe("items: [Lithium, Hells Bells]\n");
  });

  it("quotes on the way in, so a title full of punctuation still parses back", () => {
    const out = appendPlaylistItem("items: []\n", {
      song: "Rock 'n' Roll: Part 2",
    }) as string;
    expect(parsePlaylist(out)?.items).toEqual([
      { song: "Rock 'n' Roll: Part 2" },
    ]);
  });

  it("refuses a shape it cannot extend rather than guessing", () => {
    // A flow list spread over lines, and an `items:` that is not a list at all. Inventing a
    // second `items:` key lower down would make the two halves of the file disagree.
    expect(appendPlaylistItem("items: [\n  Lithium,\n]\n", { song: "x" })).toBe(
      null,
    );
    expect(appendPlaylistItem("items: nonsense\n", { song: "x" })).toBe(null);
    // A mapping cannot go inside a flow sequence at this level of effort.
    expect(
      appendPlaylistItem("items: [a]\n", { song: "x", variant: "v" }),
    ).toBe(null);
  });

  it("survives being run twice, which is what clicking twice does", () => {
    const once = appendPlaylistItem(playlistStub("Set"), {
      song: "Lithium",
    }) as string;
    const twice = appendPlaylistItem(once, { song: "Hells Bells" }) as string;
    expect(parsePlaylist(twice)?.items.map((i) => i.song)).toEqual([
      "Lithium",
      "Hells Bells",
    ]);
  });
});
