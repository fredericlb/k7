// The generator this app loads is the browser bundle, which needs a DOM. What a node test
// can still hold it to is the input: the markup, and that the library accepts the shape.

import type { EpubChapter } from "@k7/shared/epub";
import { epubInput } from "@k7/shared/epub";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { Song } from "../types";
import { unwrapDefault } from "./songEpub";

const song = (over: Partial<Song> = {}): Song => ({
  id: "s1",
  artist: "Nina Simone",
  title: "Sinnerman",
  lyrics: "Oh sinnerman",
  tablature: "e|---0---|",
  sheets: [],
  audio: null,
  favorite: false,
  createdAt: "2026-09-07T10:00:00Z",
  ...over,
});

// The frontend passes api.sheetFileUrl here; the shape is what matters, not the host.
const sheetUrl = (sheet: { id: string; name: string }) =>
  `/api/songs/s1/sheets/${sheet.id}/${encodeURIComponent(sheet.name)}`;

describe("epubInput", () => {
  it("makes a chapter per kind of text, and none for what is empty", () => {
    expect(
      epubInput(song(), sheetUrl).chapters.map((c: EpubChapter) => c.title),
    ).toEqual(["Lyrics", "Tablature"]);
    expect(
      epubInput(song({ tablature: "" }), sheetUrl).chapters.map(
        (c: EpubChapter) => c.title,
      ),
    ).toEqual(["Lyrics"]);
  });

  it("still makes one chapter for a song with no text at all", () => {
    const { chapters } = epubInput(
      song({ lyrics: "", tablature: "" }),
      sheetUrl,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Sinnerman");
  });

  it("keeps the columns, in a pre, and escapes what would end the tag", () => {
    const { chapters } = epubInput(
      song({ lyrics: "a < b & c", tablature: "" }),
      sheetUrl,
    );
    expect(chapters[0].content).toBe("<pre>a &lt; b &amp; c</pre>");
  });

  it("points an image chapter at the name-bearing address, and drops PDF sheets", () => {
    const { chapters } = epubInput(
      song({
        lyrics: "",
        tablature: "",
        sheets: [
          { id: "f1", name: "score.pdf", mime: "application/pdf" },
          { id: "f2", name: "page 1.png", mime: "image/png" },
        ],
      }),
      sheetUrl,
    );
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe("Sheet");
    expect(chapters[0].content).toContain("/sheets/f2/page%201.png");
    expect(chapters[0].content).not.toContain("score.pdf");
  });
});

describe("the library, on that input", () => {
  it("accepts it and answers an EPUB", async () => {
    // The node build of the same generator: same validation, same writer, no DOM.
    const epub = (await import("epub-gen-memory")).default;
    const { options, chapters } = epubInput(song(), sheetUrl);
    const book = await epub(options, chapters);

    const files = unzipSync(new Uint8Array(book));
    expect(new TextDecoder().decode(files.mimetype)).toBe(
      "application/epub+zip",
    );
    expect(Object.keys(files)).toContain("META-INF/container.xml");
  });
});

describe("unwrapDefault", () => {
  it("reaches through a CommonJS wrapper, and leaves a bare function alone", () => {
    const fn = () => "book";
    expect(unwrapDefault({ default: fn, EPub: class {} })).toBe(fn);
    expect(unwrapDefault(fn)).toBe(fn);
  });
});
