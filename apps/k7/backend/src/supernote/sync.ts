// Pushing the songbook onto a Supernote, through the user's own private cloud.
//
// The device syncs one account, so k7 signs in as that account and drops the books in a
// folder of it; nothing is ever pulled back. What decides a re-upload is a hash of the
// song's TEXT, not of the book: a generated EPUB carries a fresh uuid and a date, so its
// own bytes differ on every build and would make every hour look like a change.
// The rest of the reasoning is in ../../../docs/supernote.md.

import { createHash } from "node:crypto";
import { EPUB_CSS } from "@k7/shared/epub";
import { songBase, uniqueNames } from "@k7/shared/naming";
import { listSongs } from "../store.ts";
import {
  deleteFiles,
  ensureFolderPath,
  listDirectory,
  login,
  uploadFile,
} from "./client.ts";
import { markRun, readCredentials, readPushed } from "./config.ts";
import { buildSongEpub } from "./epub.ts";

/** Where the books land on the device. `Document` is the folder its reader opens. */
export const REMOTE_FOLDER = "Document/Songbook";

export interface SyncReport {
  uploaded: number;
  unchanged: number;
  failed: string[];
  /** Copies the server made of a file we replaced, and that we took back out. */
  conflicts: number;
}

/**
 * The server does not let a name be replaced: when an upload arrives for a file it still
 * holds, it keeps the old one under `<name>_CONFLICT_<stamp>`. Deleting first usually wins
 * that race and sometimes does not, and the loser is a song the device shows twice.
 * So the copies are swept at the end of a run — only ever those of names WE wrote.
 */
export function conflictCopies(
  ours: string[],
  remote: { id: string; fileName: string }[],
): string[] {
  const patterns = ours.map((name) => {
    const stem = name
      .replace(/\.epub$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${stem}_CONFLICT_\\d+\\.epub$`);
  });
  return remote
    .filter((e) => patterns.some((p) => p.test(e.fileName)))
    .map((e) => e.id);
}

/** One user at a time: an hourly tick must not overtake a run still uploading. */
const running = new Set<string>();

/**
 * What a song is, for the purpose of noticing it changed — and the stylesheet with it.
 * The book's look is not in the song, so without it here a restyle would reach no device
 * that already holds the old one, and the run would report every song unchanged forever.
 */
export function songHash(song): string {
  return createHash("md5")
    .update(
      JSON.stringify([
        song.artist,
        song.title,
        song.lyrics,
        song.tablature,
        song.sheets.map((s) => [s.id, s.name, s.mime]),
        EPUB_CSS,
      ]),
    )
    .digest("hex");
}

export function isRunning(ownerId: string): boolean {
  return running.has(ownerId);
}

/** Build every song that changed since the last run and push it. */
export async function syncSongbook(ownerId: string): Promise<SyncReport> {
  if (running.has(ownerId)) throw new Error("a sync is already running");
  running.add(ownerId);
  try {
    const report = await run(ownerId);
    await markRun(ownerId, {
      // The count alone sends the reader to a log they do not have: the first reason travels.
      status: report.failed.length
        ? `${report.failed.length} failed — ${report.failed[0]}`.slice(0, 300)
        : "ok",
      count: report.uploaded,
    });
    return report;
  } catch (err) {
    await markRun(ownerId, { status: (err as Error).message, count: 0 });
    throw err;
  } finally {
    running.delete(ownerId);
  }
}

async function run(ownerId: string): Promise<SyncReport> {
  const credentials = await readCredentials(ownerId);
  if (!credentials) throw new Error("Supernote sync is not activated");

  const session = await login(
    credentials.baseUrl,
    credentials.account,
    credentials.password,
  );
  const folderId = await ensureFolderPath(session, REMOTE_FOLDER);
  const remote = new Map(
    (await listDirectory(session, folderId))
      .filter((e) => !e.isFolder)
      .map((e) => [e.fileName, e.id]),
  );

  const songs = await listSongs(ownerId);
  const names = uniqueNames(songs.map(songBase), "epub");
  const pushed = await readPushed(ownerId);
  const next: Record<string, string> = {};
  const report: SyncReport = {
    uploaded: 0,
    unchanged: 0,
    failed: [],
    conflicts: 0,
  };

  for (const [i, song] of songs.entries()) {
    const name = names[i];
    const hash = songHash(song);
    next[song.id] = hash;
    // Unchanged AND still on the device: the second half is what survives a manual delete.
    if (pushed[song.id] === hash && remote.has(name)) {
      report.unchanged++;
      continue;
    }
    try {
      const bytes = await buildSongEpub(song);
      // The server keeps both copies otherwise, and the device would show the song twice.
      const stale = remote.get(name);
      if (stale) await deleteFiles(session, folderId, [stale]);
      await uploadFile(session, folderId, name, bytes);
      report.uploaded++;
    } catch (err) {
      delete next[song.id];
      report.failed.push(`${songBase(song)}: ${(err as Error).message}`);
    }
  }

  // Swept on every run, not only after an upload: a copy left by an earlier one would
  // otherwise sit on the device forever, since a quiet run never looks.
  const strays = conflictCopies(names, await listDirectory(session, folderId));
  await deleteFiles(session, folderId, strays);
  report.conflicts = strays.length;

  await markRun(ownerId, {
    status: "ok",
    count: report.uploaded,
    pushed: next,
  });
  return report;
}
