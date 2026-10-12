// The export button's whole job: a file per song, zipped, handed to the browser.
//
// Songs are built one at a time. A songbook holds sheet scans, so building them in
// parallel would hold every PDF in memory at once for no wall-clock gain worth the risk,
// and one at a time is also what makes the count on the button honest.

import {
  archiveName,
  songBase,
  uniqueNames,
} from "@studio/rehearsal-shared/naming";
import { zip } from "fflate";
import type { Song } from "../types";
import { loadSheets } from "./sheets";
import { buildSongEpub } from "./songEpub";
import { buildSongPdf } from "./songPdf";

export type ExportKind = "pdf" | "epub";

export interface ExportResult {
  /** The name the zip is downloaded under. */
  file: string;
  songs: number;
  /** Songs that threw, by name — the zip holds every other one. */
  failed: string[];
  /** Sheet files the format could not carry, by name. */
  skipped: string[];
}

/** Every song as its own file inside one zip. Kept apart from the download so it can be tested. */
export async function buildSongbookZip(
  kind: ExportKind,
  songs: Song[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult & { bytes: Uint8Array }> {
  const names = uniqueNames(songs.map(songBase), kind);
  const entries: Record<string, Uint8Array> = {};
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const [i, song] of songs.entries()) {
    try {
      entries[names[i]] = await buildOne(kind, song, skipped);
    } catch {
      failed.push(songBase(song));
    }
    onProgress?.(i + 1, songs.length);
  }

  return {
    bytes: await zipAsync(entries),
    file: archiveName(kind),
    songs: Object.keys(entries).length,
    failed,
    skipped,
  };
}

/** The button's call: build the zip, then hand it to the browser. */
export async function exportSongbook(
  kind: ExportKind,
  songs: Song[],
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const { bytes, ...result } = await buildSongbookZip(kind, songs, onProgress);
  download(bytes, result.file);
  return result;
}

async function buildOne(
  kind: ExportKind,
  song: Song,
  skipped: string[],
): Promise<Uint8Array> {
  if (kind === "epub") {
    const blob = await buildSongEpub(song);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const built = await buildSongPdf(song, await loadSheets(song));
  skipped.push(...built.skipped);
  return built.bytes;
}

/** fflate's callback form, promisified: it moves the deflating off the main thread. */
function zipAsync(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(entries, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
