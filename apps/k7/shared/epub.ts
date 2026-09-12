// One song -> the input an EPUB generator needs: a chapter for the lyrics, one for the
// tablature, one for the sheet images.
//
// Shared because the songbook is exported from BOTH sides — the browser's zip and the
// backend's Supernote sync — and a book that differs by who built it would be a bug
// nobody could see. How a sheet resolves to an address is the caller's, and the only
// difference between the two: ../docs/export.md.

import type { SheetFile, Song } from "./types.ts";

/**
 * Held apart from any page's stylesheet: it ships INSIDE the book. Sizes stay in `em` and
 * never px, so a reader's own font setting still scales them: the body text is now the
 * reader's own size, and the margin is what a chord grid needs rather than what prose does.
 * Change anything here and every book is re-pushed: ../docs/supernote.md says why.
 */
export const EPUB_CSS = `
body { font-family: serif; margin: 0.25em; }
h1 { font-size: 1.2em; }
pre { font-family: monospace; font-size: 1em; white-space: pre-wrap; }
img { max-width: 100%; }
`;

/** Where a sheet's bytes are, for whoever is generating: an http URL, or a file one. */
export type SheetUrl = (sheet: SheetFile) => string;

export interface EpubChapter {
  title: string;
  content: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A chapter, or nothing at all when the song has no such text. */
function textChapter(title: string, text: string): EpubChapter[] {
  if (!text.trim()) return [];
  return [{ title, content: `<pre>${escapeHtml(text)}</pre>` }];
}

/** The sheet images, in order. A PDF cannot be a page of an EPUB, so it is not one. */
function sheetChapter(song: Song, sheetUrl: SheetUrl): EpubChapter[] {
  const images = song.sheets.filter((s) => s.mime !== "application/pdf");
  if (images.length === 0) return [];
  const content = images
    .map(
      (s) =>
        `<p><img src="${escapeHtml(sheetUrl(s))}" alt="${escapeHtml(s.name)}"/></p>`,
    )
    .join("\n");
  return [{ title: "Sheet", content }];
}

/**
 * Everything the generator is given, apart from the generator itself. Pulled out because
 * one side loads a browser bundle: this is the half a node test can hold against the real one.
 */
export function epubInput(song: Song, sheetUrl: SheetUrl) {
  const title = song.title || "untitled";
  const chapters = [
    ...textChapter("Lyrics", song.lyrics),
    ...textChapter("Tablature", song.tablature),
    ...sheetChapter(song, sheetUrl),
  ];
  return {
    options: {
      title,
      author: song.artist || undefined,
      description: song.artist ? `${song.artist} — ${title}` : title,
      lang: "en",
      css: EPUB_CSS,
      // A book must survive an image it could not fetch: the words are what was asked for.
      ignoreFailedDownloads: true,
      verbose: false,
    },
    // A song with neither words nor tablature is still a book, and a book needs one chapter.
    chapters: chapters.length > 0 ? chapters : [{ title, content: "<p/>" }],
  };
}
