// Fetching a song's sheet files, which only the PDF export needs: the EPUB library
// downloads its own images from the markup.
//
// pdf-lib embeds JPEG and PNG and nothing else, so every other image the songbook
// accepts (GIF, WebP, SVG) is decoded by the browser and re-encoded as JPEG first.

import { api } from "../api";
import type { Song } from "../types";
import type { LoadedSheet } from "./songPdf";

const JPEG_QUALITY = 0.85;
const EMBEDDABLE = /^(application\/pdf|image\/(png|jpeg))$/;

/** Every sheet of a song, as bytes pdf-lib can take. A file that will not load is dropped. */
export async function loadSheets(song: Song): Promise<LoadedSheet[]> {
  const out: LoadedSheet[] = [];
  for (const sheet of song.sheets) {
    try {
      const res = await fetch(api.sheetFileUrl(song.id, sheet.id, sheet.name), {
        credentials: "include",
      });
      if (!res.ok) continue;
      const blob = await res.blob();
      out.push(
        EMBEDDABLE.test(sheet.mime)
          ? {
              name: sheet.name,
              mime: sheet.mime,
              bytes: new Uint8Array(await blob.arrayBuffer()),
            }
          : {
              name: sheet.name,
              mime: "image/jpeg",
              bytes: await transcodeToJpeg(blob, sheet.name),
            },
      );
    } catch {
      // A sheet that cannot be read costs itself; the song and the export carry on.
    }
  }
  return out;
}

/**
 * Anything the browser can display, redrawn as JPEG. It goes through an `<img>` rather
 * than `createImageBitmap`, which is the only route that also decodes SVG everywhere.
 */
async function transcodeToJpeg(
  blob: Blob,
  name: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas context");
    // JPEG has no transparency: without this the transparent parts come out black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const encoded = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    canvas.width = 0;
    canvas.height = 0;
    if (!encoded) throw new Error(`could not re-encode ${name}`);
    return new Uint8Array(await encoded.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
