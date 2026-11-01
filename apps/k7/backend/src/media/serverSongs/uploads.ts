// uploads.ts — every song of this machine's médiathèque the server lacks, sent up by this backend alone: at start and
// every few minutes, each song folder's files PUT through the server's device door, then the song FOLLOWS the server.
// What reads wrong: a song the server removed is never sent back, and one half sent is finished, not taken for the
// server's. See ../../../docs/media/songUploads.md.

import { openAsBlob } from "node:fs";
import { listFamilyFresh } from "@studio/mediatek/catalogue";
import { safePath } from "@studio/mediatek/layout";
import { type Manifest, manifest } from "@studio/mediatek/manifest";
import {
  clearUploading,
  hasLeft,
  markUploading,
  readSynced,
  readUploading,
  rowsUnder,
  writeSynced,
} from "@studio/mediatek/synced";
import { DEVICE_HEADER, DOOR_PATH } from "../../remote/door.ts";
import { beginJob } from "./jobs.ts";
import { noteReach } from "./reach.ts";
import { type PairedServer, serverManifest } from "./server.ts";

/** How often the library is looked over once the first run is done. */
export const UPLOAD_EVERY_MS = 3 * 60_000;
/** After a start, behind the update check, so what the server changed comes down first. */
const FIRST_UPLOAD_MS = 30_000;
/** A master can be long and an uplink slow. */
const PUT_TIMEOUT_MS = 30 * 60_000;

/** The songs of this machine the server should have and lacks: never synced, never removed there, or half sent to it. */
export function songsToUpload(
  local: string[],
  server: Manifest,
  base: string,
): string[] {
  return local.filter((path) => {
    const abs = safePath(path);
    if (readSynced(abs) || hasLeft(abs)) return false;
    if (readUploading(abs) === base) return true;
    // Already there by path: the server's copy is the one kept, never overwritten from here.
    return rowsUnder(server, path).length === 0;
  });
}

/** The server answered and said no: that song fails, the others still go. */
class Refused extends Error {}

/** One file PUT into the server's médiathèque as the person who paired this machine. */
async function put(server: PairedServer, path: string): Promise<void> {
  const at = `${server.base}${DOOR_PATH}/api/mediatek/file?path=${encodeURIComponent(path)}`;
  const res = await fetch(at, {
    method: "PUT",
    headers: {
      [DEVICE_HEADER]: server.token,
      "content-type": "application/octet-stream",
    },
    body: await openAsBlob(safePath(path)),
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Refused(`${path}: ${res.status} ${res.statusText}`);
}

/** Send one song's files the server lacks, by size: a resumed upload sends again only what did not land. */
async function uploadSong(
  server: PairedServer,
  path: string,
  mine: Manifest,
  theirs: Manifest,
): Promise<void> {
  const abs = safePath(path);
  markUploading(abs, server.base);
  const there = new Map(rowsUnder(theirs, path).map((f) => [f.path, f.bytes]));
  for (const f of rowsUnder(mine, path))
    if (there.get(f.path) !== f.bytes) await put(server, f.path);
}

let uploading: Promise<void> | null = null;
let runs = 0;

/** One look over the library for each server, listed as jobs; a second call while one runs joins it. */
export function uploadSongs(servers: () => PairedServer[]): Promise<void> {
  uploading ??= (async () => {
    // One server takes a song: the first one paired, since a song follows one server only.
    const [server] = servers();
    if (!server) return;
    const local = (await listFamilyFresh("songs")).entries.map((e) => e.path);
    if (!local.length) return;
    let theirs: { rev: string; files: Manifest };
    try {
      theirs = await serverManifest(server, "songs");
      noteReach(server.base, true);
    } catch {
      // Away: every song waits, and the next run tries again.
      noteReach(server.base, false);
      return;
    }
    const todo = songsToUpload(local, theirs.files, server.base);
    if (!todo.length) return;
    const run = ++runs;
    const mine = await manifest("songs");
    const sent: string[] = [];
    for (const path of todo) {
      const end = beginJob({
        key: `upload:${run}:${path}`,
        kind: "upload",
        path,
        phase: "running",
      });
      try {
        await uploadSong(server, path, mine, theirs.files);
        sent.push(path);
        end({});
      } catch (e) {
        end({ phase: "failed", error: (e as Error).message });
        // A server that stopped answering would fail every song after it the same way: the next run resumes.
        if (!(e instanceof Refused)) {
          noteReach(server.base, false);
          break;
        }
      }
    }
    if (!sent.length) return;
    // The server's own rows, read once the songs landed: what each sidecar records, so the songs now follow it.
    // Unread, the markers stay, and the next run sends nothing again before it writes them.
    const after = await serverManifest(server, "songs");
    for (const path of sent) {
      const rows = rowsUnder(after.files, path);
      if (!rows.length) continue;
      writeSynced(safePath(path), {
        server: server.base,
        rev: after.rev,
        files: rows,
      });
      clearUploading(safePath(path));
    }
  })().finally(() => {
    uploading = null;
  });
  return uploading;
}

/** At start (shortly after) and every UPLOAD_EVERY_MS, for as long as the process runs. */
export function startSongUploads(servers: () => PairedServer[]): () => void {
  const run = () =>
    void uploadSongs(servers).catch((e: Error) =>
      console.error(`song uploads: ${e.message}`),
    );
  const first = setTimeout(run, FIRST_UPLOAD_MS);
  const every = setInterval(run, UPLOAD_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
