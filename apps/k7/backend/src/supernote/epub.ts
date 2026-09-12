// One song -> EPUB bytes, on the server. What goes in the book is `@k7/shared/epub`,
// shared with the browser's own export so the two cannot drift.
//
// The images are handed over as `file://` paths into the sheet cache: the generator
// reads them off the disk, and their extension is what tells it the media type.

import { epubInput } from "@k7/shared/epub";
import { ensureSheetFileCached } from "../store.ts";

/** A CommonJS default export is the whole `module.exports`; the generator is inside it. */
function unwrapDefault<T>(loaded: T): T {
  return (loaded as { default?: T }).default ?? loaded;
}

export async function buildSongEpub(song): Promise<Uint8Array> {
  const epub = unwrapDefault((await import("epub-gen-memory")).default);

  // Resolved up front: the input builder is synchronous, and reaching Grist is not.
  const paths = new Map<string, string>();
  for (const sheet of song.sheets) {
    if (sheet.mime === "application/pdf") continue;
    const cached = await ensureSheetFileCached(song.id, sheet.id);
    if (cached) paths.set(sheet.id, `file://${cached.filePath}`);
  }

  const { options, chapters } = epubInput(
    song,
    (sheet) => paths.get(sheet.id) ?? "",
  );
  return new Uint8Array(await epub(options, chapters));
}
