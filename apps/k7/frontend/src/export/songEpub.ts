// One song -> one EPUB blob, in the browser. What goes IN the book is shared with the
// backend's Supernote sync (`@k7/shared/epub`); this file is only the generator and the
// awkward way a CommonJS bundle hands it over — ../../../docs/export.md.

import { epubInput } from "@k7/shared/epub";
import { api } from "../api";
import type { Song } from "../types";

/**
 * The generator itself, out of a CommonJS bundle whose default export is its whole
 * `module.exports` — the function is one level further down, and only under some bundlers.
 */
export function unwrapDefault<T>(loaded: T): T {
  return (loaded as { default?: T }).default ?? loaded;
}

/** One song as an EPUB blob. */
export async function buildSongEpub(song: Song): Promise<Blob> {
  const epub = unwrapDefault((await import("epub-gen-memory/bundle")).default);
  const { options, chapters } = epubInput(song, (sheet) =>
    api.sheetFileUrl(song.id, sheet.id, sheet.name),
  );
  return epub(options, chapters);
}
