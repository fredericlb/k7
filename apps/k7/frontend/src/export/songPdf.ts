// One song -> one PDF: its text in a monospace face, then its sheets appended.
//
// Two constraints shape everything here. The standard fonts encode WinAnsi and nothing
// else, so text that leaves that repertoire is transliterated before it reaches pdf-lib
// rather than throwing mid-export; and a chord sheet is column art, so the body is
// Courier and wrapping counts characters instead of measuring them.
// Why the pages stay A4 even for an image: ../../../docs/export.md.

import type { PDFDocument, PDFFont, PDFPage } from "pdf-lib";
import type { Song } from "../types";

/** A sheet file already fetched — the builder never touches the network. */
export interface LoadedSheet {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface SongPdf {
  bytes: Uint8Array;
  /** Sheets left out, by name: a format pdf-lib cannot embed, or bytes it refused. */
  skipped: string[];
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const BODY_SIZE = 9;
const BODY_LEADING = 11.5;
// Courier advances 0.6 em at every glyph, which is what makes a column count a width.
const COLS = Math.floor((A4[0] - 2 * MARGIN) / (BODY_SIZE * 0.6));

/** The WinAnsi codepoints above 127 that are not Latin-1: quotes, dashes, and friends. */
const WIN_ANSI_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Characters worth a spelling rather than a `?`, led by the two a songbook actually carries. */
const TRANSLITERATED: Record<string, string> = {
  "♭": "b",
  "♯": "#",
  "♮": "n",
  "→": "->",
  "←": "<-",
  "\u00a0": " ",
};

/**
 * Text a standard font can draw. Anything outside WinAnsi is spelled out or becomes `?`,
 * because pdf-lib throws on the first glyph it cannot encode and would lose the whole export.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
    const spelled = TRANSLITERATED[ch];
    if (spelled !== undefined) {
      out += spelled;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    const drawable =
      ch === "\n" ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      WIN_ANSI_EXTRAS.includes(ch);
    out += drawable ? ch : "?";
  }
  return out;
}

/** One paragraph over as many lines as it needs, broken on a space when there is one. */
export function wrapMonospace(line: string, cols = COLS): string[] {
  if (line.length <= cols) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > cols) {
    const space = rest.lastIndexOf(" ", cols);
    // A chord grid has no space to break on: cut it rather than let it run off the page.
    const at = space > cols / 2 ? space : cols;
    out.push(rest.slice(0, at));
    rest = rest.slice(space > cols / 2 ? at + 1 : at);
  }
  out.push(rest);
  return out;
}

/** Where the next line goes, so that adding one is the same call on every page. */
interface Cursor {
  page: PDFPage;
  y: number;
}

function newPage(pdf: PDFDocument, cursor: Cursor): void {
  cursor.page = pdf.addPage(A4);
  cursor.y = A4[1] - MARGIN;
}

function writeLines(
  pdf: PDFDocument,
  cursor: Cursor,
  lines: string[],
  font: PDFFont,
  size: number,
  leading: number,
): void {
  for (const line of lines) {
    if (cursor.y - leading < MARGIN) newPage(pdf, cursor);
    cursor.y -= leading;
    if (line)
      cursor.page.drawText(line, { x: MARGIN, y: cursor.y, size, font });
  }
}

/** A titled block of the song's own text, skipped entirely when there is none. */
function writeSection(
  pdf: PDFDocument,
  cursor: Cursor,
  heading: string,
  text: string,
  fonts: { head: PDFFont; body: PDFFont },
): void {
  if (!text.trim()) return;
  writeLines(pdf, cursor, ["", heading], fonts.head, 11, 16);
  const lines = toWinAnsi(text)
    .split("\n")
    .flatMap((l) => wrapMonospace(l));
  writeLines(pdf, cursor, lines, fonts.body, BODY_SIZE, BODY_LEADING);
}

/** The rectangle an image gets on its own A4 page: fitted inside the margins, centred. */
function fitBox(image: { width: number; height: number }): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const scale = Math.min(
    (A4[0] - 2 * MARGIN) / image.width,
    (A4[1] - 2 * MARGIN) / image.height,
    1,
  );
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (A4[0] - width) / 2, y: (A4[1] - height) / 2, width, height };
}

/** One song as PDF bytes: title, lyrics, tablature, then every sheet it carries. */
export async function buildSongPdf(
  song: Song,
  sheets: LoadedSheet[] = [],
): Promise<SongPdf> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(song.title || "untitled");
  pdf.setAuthor(song.artist || "");

  const fonts = {
    head: await pdf.embedFont(StandardFonts.HelveticaBold),
    sub: await pdf.embedFont(StandardFonts.Helvetica),
    body: await pdf.embedFont(StandardFonts.Courier),
  };

  const cursor: Cursor = { page: pdf.addPage(A4), y: A4[1] - MARGIN };
  cursor.y -= 18;
  cursor.page.drawText(toWinAnsi(song.title || "untitled"), {
    x: MARGIN,
    y: cursor.y,
    size: 18,
    font: fonts.head,
  });
  if (song.artist) {
    cursor.y -= 16;
    cursor.page.drawText(toWinAnsi(song.artist), {
      x: MARGIN,
      y: cursor.y,
      size: 11,
      font: fonts.sub,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  writeSection(pdf, cursor, "Lyrics", song.lyrics, fonts);
  writeSection(pdf, cursor, "Tablature", song.tablature, fonts);

  const skipped: string[] = [];
  for (const sheet of sheets) {
    try {
      if (sheet.mime === "application/pdf") {
        const source = await PDFDocument.load(sheet.bytes, {
          ignoreEncryption: true,
        });
        const pages = await pdf.copyPages(source, source.getPageIndices());
        for (const page of pages) pdf.addPage(page);
      } else if (sheet.mime === "image/png") {
        const png = await pdf.embedPng(sheet.bytes);
        pdf.addPage(A4).drawImage(png, fitBox(png));
      } else if (sheet.mime === "image/jpeg") {
        const jpg = await pdf.embedJpg(sheet.bytes);
        pdf.addPage(A4).drawImage(jpg, fitBox(jpg));
      } else {
        skipped.push(sheet.name);
      }
    } catch {
      // One unreadable sheet costs its own page, never the song and never the export.
      skipped.push(sheet.name);
    }
  }

  // pdf-lib answers the wider Uint8Array<ArrayBufferLike>; copy into a plain one.
  return { bytes: new Uint8Array(await pdf.save()), skipped };
}
