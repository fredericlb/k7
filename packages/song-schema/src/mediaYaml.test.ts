import { describe, expect, it } from "vitest";
import {
  appendMediaPlaylistItem,
  mediaPlaylistStub,
  moveMediaPlaylistItem,
  parseMediaPlaylist,
  removeMediaPlaylistItem,
  yamlScalar,
} from "./mediaYaml.ts";

describe("parseMediaPlaylist", () => {
  it("reads a title and the items, in the file's own order", () => {
    const p = parseMediaPlaylist(
      [
        "title: Été 2026",
        "items:",
        "  - AC-DC/Back in Black/Hells Bells",
        "  - song: Nirvana/Nevermind/Lithium",
        "    variant: instrumental",
      ].join("\n"),
    );
    expect(p?.title).toBe("Été 2026");
    expect(p?.items).toEqual([
      { song: "AC-DC/Back in Black/Hells Bells" },
      { song: "Nirvana/Nevermind/Lithium", variant: "instrumental" },
    ]);
  });

  it("drops a line that names no song rather than inventing a ref for it", () => {
    const p = parseMediaPlaylist(
      ["items:", "  - [x]", "  - variant: sans-voix", "  - Lithium"].join("\n"),
    );
    expect(p?.items).toEqual([{ song: "Lithium" }]);
  });

  it("is null when the text is not a playlist at all", () => {
    expect(parseMediaPlaylist("items: [\n")).toBeNull();
    expect(parseMediaPlaylist("- just\n- a list\n")).toBeNull();
    expect(parseMediaPlaylist("")).toBeNull();
  });

  it("is an empty playlist when there is no items key, not a failure", () => {
    expect(parseMediaPlaylist("title: Set\n")).toEqual({
      title: "Set",
      items: [],
    });
  });

  it("round-trips its own stub, a title YAML would misread included", () => {
    expect(parseMediaPlaylist(mediaPlaylistStub("répèt du jeudi"))).toEqual({
      title: "répèt du jeudi",
      items: [],
    });
    expect(parseMediaPlaylist(mediaPlaylistStub("No"))?.title).toBe("No");
  });
});

describe("yamlScalar", () => {
  it("leaves a song path alone — spaces, ampersands and parentheses and all", () => {
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
    expect(yamlScalar("Artist: Album")).toBe("'Artist: Album'");
    expect(yamlScalar("*star")).toBe("'*star'");
    expect(yamlScalar("track #3")).toBe("'track #3'");
    expect(yamlScalar(" padded ")).toBe("' padded '");
    expect(yamlScalar("")).toBe("''");
    expect(yamlScalar("No")).toBe("'No'");
    expect(yamlScalar("42")).toBe("'42'");
  });

  it("doubles a quote rather than escaping it", () => {
    expect(yamlScalar("Rock 'n' Roll: Part 2")).toBe(
      "'Rock ''n'' Roll: Part 2'",
    );
  });
});

describe("appendMediaPlaylistItem", () => {
  it("adds to the end of an existing block, keeping the file's own indentation", () => {
    const out = appendMediaPlaylistItem("title: Set\nitems:\n    - Lithium\n", {
      song: "Hells Bells",
    });
    expect(out).toBe("title: Set\nitems:\n    - Lithium\n    - Hells Bells\n");
  });

  it("turns the stub's empty flow into a block", () => {
    expect(
      appendMediaPlaylistItem(mediaPlaylistStub("Set"), { song: "Lithium" }),
    ).toBe("# Set\ntitle: Set\nitems:\n  - Lithium\n");
  });

  it("writes a mapping when the line names a variant, aligned past the dash", () => {
    const out = appendMediaPlaylistItem("items:\n  - Lithium\n", {
      song: "Nevermind/Lithium",
      variant: "instrumental",
    }) as string;
    expect(out).toBe(
      "items:\n  - Lithium\n  - song: Nevermind/Lithium\n    variant: instrumental\n",
    );
  });

  it("adds the key when the file has none", () => {
    expect(appendMediaPlaylistItem("title: Set", { song: "Lithium" })).toBe(
      "title: Set\nitems:\n  - Lithium\n",
    );
  });

  it("extends a one-line flow list in its own notation", () => {
    expect(
      appendMediaPlaylistItem("items: [Lithium]\n", { song: "Hells Bells" }),
    ).toBe("items: [Lithium, Hells Bells]\n");
  });

  it("refuses a shape it cannot extend rather than guessing", () => {
    expect(
      appendMediaPlaylistItem("items: [\n  Lithium,\n]\n", { song: "x" }),
    ).toBe(null);
    expect(appendMediaPlaylistItem("items: nonsense\n", { song: "x" })).toBe(
      null,
    );
    expect(
      appendMediaPlaylistItem("items: [a]\n", { song: "x", variant: "v" }),
    ).toBe(null);
  });
});

describe("removing and moving a line", () => {
  const SET = "title: Set\nitems:\n  - a\n  - song: b\n    variant: v\n  - c\n";

  it("drops a line with its continuation, and leaves an empty list behind the last", () => {
    expect(removeMediaPlaylistItem(SET, 1)).toBe(
      "title: Set\nitems:\n  - a\n  - c\n",
    );
    expect(removeMediaPlaylistItem("items:\n  - a\n", 0)).toBe("items: []\n");
    expect(removeMediaPlaylistItem(SET, 3)).toBeNull();
  });

  it("moves a line block to another position", () => {
    expect(moveMediaPlaylistItem(SET, 0, 2)).toBe(
      "title: Set\nitems:\n  - song: b\n    variant: v\n  - c\n  - a\n",
    );
    expect(moveMediaPlaylistItem("items: [a, b]\n", 0, 1)).toBeNull();
  });
});
