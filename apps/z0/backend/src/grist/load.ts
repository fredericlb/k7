import { execFile } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  Category,
  OrderEntry,
  Session,
  Song,
  Track,
} from "../session/model.ts";
import { dataDir } from "../state.ts";
import type { GristClient, GristRecord } from "./client.ts";
import {
  asBool,
  asFloat,
  asInt,
  asString,
  buildAudioFilename,
  firstAttachmentId,
  optInt,
  parseEffects,
  parseRefList,
  resolveTrim,
} from "./values.ts";

const execFileP = promisify(execFile);

/** Lightweight session row for the picker UI (grist_load.go). */
export interface GristSessionInfo {
  id: number;
  name: string;
  /** Not serialized to clients. */
  guestPassword: string;
}

/** Every row of the Sessions table, sorted by id. */
export async function listGristSessions(
  g: GristClient,
): Promise<GristSessionInfo[]> {
  const rows = await g.listRecords("Sessions");
  return rows
    .map((r) => ({
      id: r.id,
      name: asString(r.fields.name),
      guestPassword: asString(r.fields.guestPassword),
    }))
    .sort((a, b) => a.id - b.id);
}

/**
 * One update per attachment download: `done` completed, `total` planned
 * (already-cached files excluded), `name` the file being written. A first
 * call with done=0 fires before any download so a UI can render a 0% bar.
 */
export type LoadProgressFn = (
  done: number,
  total: number,
  name: string,
) => void;

/**
 * Fetch a full session (categories, songs, tracks, order) from Grist,
 * download any missing audio attachments into the local cache
 * (data/audio/grist/<deterministic name>), and return the in-memory Session
 * shape every consumer expects. Mirrors grist_load.go's LoadSessionFromGrist —
 * see the Go source for the full traversal/pairing rationale.
 */
export async function loadSessionFromGrist(
  g: GristClient,
  sessionId: number,
  progress?: LoadProgressFn,
): Promise<Session> {
  const sessions = await g.listRecords("Sessions", { id: sessionId });
  if (sessions.length === 0) throw new Error(`session ${sessionId} not found`);
  const srow = sessions[0];
  const sessionName = asString(srow.fields.name);
  const guestPassword = asString(srow.fields.guestPassword);

  const orderIds = parseRefList(srow.fields.order);
  if (orderIds.length === 0) {
    throw new Error(
      `session ${sessionId} has no order entries — nothing to play`,
    );
  }

  const orderRowsById = await fetchByIds(g, "OrderEntries", orderIds);

  // Categories are discovered through OrderEntries but listed by ascending
  // row id (declaration order), independent of play order — play order lives
  // entirely in session.order.
  const catIds: number[] = [];
  const seenCat = new Set<number>();
  for (const oid of orderIds) {
    const orow = orderRowsById.get(oid);
    if (!orow || asString(orow.fields.type) === "pause") continue;
    const cid = asInt(orow.fields.category);
    if (cid > 0 && !seenCat.has(cid)) {
      catIds.push(cid);
      seenCat.add(cid);
    }
  }
  catIds.sort((a, b) => a - b);

  const catRowsById = await fetchByIds(g, "Categories", catIds);

  const allSongIds: number[] = [];
  const songIdsByCat = new Map<number, number[]>();
  for (const cid of catIds) {
    const row = catRowsById.get(cid);
    if (!row) continue;
    const ids = parseRefList(row.fields.songs);
    songIdsByCat.set(cid, ids);
    allSongIds.push(...ids);
  }
  const songRowsById = await fetchByIds(g, "Songs", allSongIds);

  const allTrackIds: number[] = [];
  const trackIdsBySong = new Map<number, number[]>();
  for (const sid of allSongIds) {
    const row = songRowsById.get(sid);
    if (!row) continue;
    const ids = parseRefList(row.fields.tracks);
    trackIdsBySong.set(sid, ids);
    allTrackIds.push(...ids);
  }
  const trackRowsById = await fetchByIds(g, "Tracks", allTrackIds);

  // Resolve attachment ids → fileIdents (content-addressed cache keys).
  const attachmentIds: number[] = [];
  for (const r of trackRowsById.values()) {
    const id = firstAttachmentId(r.fields.audio);
    if (id !== null) attachmentIds.push(id);
  }
  const fileIdents = await g.attachmentFileIdents(attachmentIds);

  const plan = planCachedTracks(trackIdsBySong, trackRowsById, fileIdents);
  const cache = await AttachmentCache.create(g, fileIdents, plan, progress);
  if (progress && cache.total > 0) progress(0, cache.total, "");

  const categories: Category[] = [];
  const catNameById = new Map<number, string>();

  for (const cid of catIds) {
    const crow = catRowsById.get(cid);
    if (!crow) {
      console.log(
        `[Grist] WARN session ${sessionId} references missing category id=${cid}`,
      );
      continue;
    }
    const mode = asString(crow.fields.mode);
    const cat: Category = {
      name: asString(crow.fields.name),
      mode,
      notice: asString(crow.fields.notice),
      illustration: asString(crow.fields.illustration),
      trackType: asString(crow.fields.trackType),
      liveOnly: asBool(crow.fields.liveOnly),
      songs: [],
    };
    catNameById.set(cid, cat.name);

    for (const sid of songIdsByCat.get(cid) ?? []) {
      const songRow = songRowsById.get(sid);
      if (!songRow) {
        console.log(
          `[Grist] WARN category "${cat.name}" references missing song id=${sid}`,
        );
        continue;
      }
      const song: Song = {
        artist: "",
        title: "",
        label: asString(songRow.fields.label),
        status: asString(songRow.fields.status),
        answer: asString(songRow.fields.answer),
        liveOnly: asBool(songRow.fields.liveOnly),
        effects: parseEffects(songRow.fields),
      };
      // Partition the song's tracks: type===trackType → questions (playable),
      // type==="" → originals (reveal audio). Empty trackType = all questions.
      const built = await buildTracks(
        sid,
        trackIdsBySong.get(sid) ?? [],
        trackRowsById,
        cache,
      );
      const [questions, originals] = partitionTracksByType(
        built,
        cat.trackType ?? "",
      );
      if (mode === "fusion" || mode === "multi") {
        // Both modes hand the full track list to the player; fusion pairs
        // each question with its original as the reveal.
        song.tracks = questions;
        if (mode === "fusion") {
          questions.forEach((t, i) => {
            if (i < originals.length) t.fullSong = originals[i].path;
          });
        }
      } else if (questions.length > 0) {
        const t = questions[0];
        song.artist = t.artist ?? "";
        song.title = t.title ?? "";
        song.path = t.path;
        song.from = t.from;
        song.to = t.to;
        song.youtubeId = t.youtubeId;
        if (originals.length > 0) song.fullSong = originals[0].path;
        if (questions.length > 1) {
          console.log(
            `[Grist] WARN song "${song.title}" (cat "${cat.name}", mode "${mode}") has ${questions.length} question tracks but mode is non-fusion/multi — extra tracks ignored`,
          );
        }
      }
      cat.songs.push(song);
    }
    categories.push(cat);
  }

  const order: OrderEntry[] = [];
  for (const oid of orderIds) {
    const orow = orderRowsById.get(oid);
    if (!orow) {
      console.log(
        `[Grist] WARN session ${sessionId} references missing order entry id=${oid}`,
      );
      continue;
    }
    const entry: OrderEntry = {};
    if (asString(orow.fields.type) === "pause") {
      entry.type = "pause";
    } else {
      entry.cat = catNameById.get(asInt(orow.fields.category)) ?? "";
      // Grist returns 0 for unset Int cells; treat 0 as unset for both bounds
      // (start=0 equals the default, end=0 would always slice empty).
      const from = optInt(orow.fields.start);
      if (from !== null && from > 0) entry.from = from;
      const to = optInt(orow.fields.end);
      if (to !== null && to > 0) entry.to = to;
    }
    order.push(entry);
  }

  const session: Session = { categories, order, guestPassword };

  console.log(
    `[Grist] Session "${sessionName}" (id=${sessionId}) loaded: ${categories.length} categories, ${order.length} order entries, ${cache.hits} cached/${cache.downloads} downloaded attachments`,
  );
  for (const cat of categories)
    console.log(`  - ${cat.name} (${cat.songs.length} songs)`);

  return session;
}

/**
 * Split a song's tracks into questions (type === trackType) and originals
 * (type === "", only when trackType ≠ ""). Order preserved — the i-th
 * question pairs with the i-th original (editor enforces interleaved order).
 */
export function partitionTracksByType(
  tracks: Track[],
  trackType: string,
): [Track[], Track[]] {
  const questions: Track[] = [];
  const originals: Track[] = [];
  for (const t of tracks) {
    if ((t.type ?? "") === trackType) questions.push(t);
    if (trackType !== "" && (t.type ?? "") === "") originals.push(t);
  }
  return [questions, originals];
}

/** Batch-fetch rows by id; callers reorder via the parent's RefList. */
export async function fetchByIds(
  g: GristClient,
  table: string,
  ids: number[],
): Promise<Map<number, GristRecord>> {
  const out = new Map<number, GristRecord>();
  if (ids.length === 0) return out;
  const rows = await g.listRecords(table, { id: ids });
  for (const r of rows) out.set(r.id, r);
  return out;
}

/**
 * Materialize Tracks in RefList order, resolving each Attachments cell into a
 * cached (pre-trimmed, pre-transcoded) file path. from/to are zeroed because
 * the cached file already embodies the window.
 */
async function buildTracks(
  songId: number,
  trackIds: number[],
  byId: Map<number, GristRecord>,
  cache: AttachmentCache,
): Promise<Track[]> {
  const out: Track[] = [];
  for (const tid of trackIds) {
    const r = byId.get(tid);
    if (!r) {
      console.log(`[Grist] WARN missing track row id=${tid}`);
      continue;
    }
    const t: Track = {
      artist: asString(r.fields.artist),
      title: asString(r.fields.title),
      type: asString(r.fields.type),
      youtubeId: asString(r.fields.youtubeId),
    };
    const attId = firstAttachmentId(r.fields.audio);
    if (attId !== null) {
      const fromSec = asFloat(r.fields.start);
      const toSec = asFloat(r.fields.end);
      try {
        t.path = await cache.ensure(
          attId,
          songId,
          t.artist ?? "",
          t.title ?? "",
          fromSec,
          toSec,
        );
      } catch (err) {
        console.log(
          `[Grist] WARN cache audio attachment ${attId} failed: ${err}`,
        );
      }
    }
    out.push(t);
  }
  return out;
}

/** One (track, attachment) pairing with its deterministic cache filename. */
interface PlannedTrack {
  filename: string;
}

/**
 * Walk every track with an audio attachment and compute the cache filename it
 * will land at, so the cache can pre-scan the disk and quote a stable
 * progress denominator. Idempotent for a given Grist state.
 */
export function planCachedTracks(
  trackIdsBySong: Map<number, number[]>,
  trackRowsById: Map<number, GristRecord>,
  fileIdents: Map<number, string>,
): PlannedTrack[] {
  const out: PlannedTrack[] = [];
  for (const [sid, tids] of trackIdsBySong) {
    for (const tid of tids) {
      const r = trackRowsById.get(tid);
      if (!r) continue;
      const attId = firstAttachmentId(r.fields.audio);
      if (attId === null) continue;
      const ident = fileIdents.get(attId) || `${attId}.bin`;
      out.push({
        filename: buildAudioFilename(
          sid,
          asString(r.fields.artist),
          asString(r.fields.title),
          asFloat(r.fields.start),
          asFloat(r.fields.end),
          ident,
        ),
      });
    }
  }
  return out;
}

/**
 * Lazily downloads Grist Attachments into data/audio/grist/, trims each to
 * its [from, to] window, and transcodes to libopus@64k in webm. Returned
 * paths are relative to the audio root (data/audio/). Filenames are
 * deterministic and content-addressed — see values.ts buildAudioFilename.
 */
class AttachmentCache {
  hits = 0;
  downloads = 0;
  readonly total: number;
  private g: GristClient;
  private root: string;
  private fileIdents: Map<number, string>;
  private onDisk: Set<string>;
  private progress?: LoadProgressFn;

  private constructor(
    g: GristClient,
    fileIdents: Map<number, string>,
    onDisk: Set<string>,
    total: number,
    progress?: LoadProgressFn,
  ) {
    this.g = g;
    this.root = join(dataDir(), "audio", "grist");
    this.fileIdents = fileIdents;
    this.onDisk = onDisk;
    this.total = total;
    this.progress = progress;
  }

  static async create(
    g: GristClient,
    fileIdents: Map<number, string>,
    plan: PlannedTrack[],
    progress?: LoadProgressFn,
  ): Promise<AttachmentCache> {
    const root = join(dataDir(), "audio", "grist");
    const onDisk = new Set<string>();
    try {
      for (const e of await readdir(root, { withFileTypes: true })) {
        if (!e.isDirectory()) onDisk.add(e.name);
      }
    } catch {
      // cache dir doesn't exist yet
    }
    const seen = new Set<string>();
    let total = 0;
    for (const p of plan) {
      if (seen.has(p.filename)) continue;
      seen.add(p.filename);
      if (!onDisk.has(p.filename)) total++;
    }
    return new AttachmentCache(g, fileIdents, onDisk, total, progress);
  }

  async ensure(
    id: number,
    songId: number,
    artist: string,
    title: string,
    fromSec: number,
    toSec: number,
  ): Promise<string> {
    let ident = this.fileIdents.get(id) ?? "";
    if (ident === "") {
      ident = `${id}.bin`;
      console.log(
        `[Grist] WARN no fileIdent for attachment ${id} — caching by id only`,
      );
    }
    const name = buildAudioFilename(
      songId,
      artist,
      title,
      fromSec,
      toSec,
      ident,
    );
    const rel = join("grist", name);
    const full = join(this.root, name);

    if (this.onDisk.has(name)) {
      this.hits++;
      return rel;
    }

    await mkdir(this.root, { recursive: true });

    // Source bytes come from the raw-attachment cache so two tracks sharing a
    // blob (or the editor preview) only download from Grist once.
    const rawRel = await cacheRawAttachment(this.g, id, ident);
    const rawAbs = join(dataDir(), "audio", rawRel);

    try {
      await transcodeOpusWebm(rawAbs, full, fromSec, toSec);
    } catch (err) {
      // Don't leave a half-written file — it would read as a cache hit later.
      await unlink(full).catch(() => {});
      throw err;
    }

    this.onDisk.add(name);
    this.downloads++;
    const [effFrom, effTo] = resolveTrim(fromSec, toSec);
    console.log(
      `[Grist] Cached attachment ${id} → ${full} (trim ${effFrom.toFixed(2)}s–${effTo.toFixed(2)}s)`,
    );
    this.progress?.(this.downloads, this.total, name);
    return rel;
  }
}

/**
 * Download an attachment's raw bytes into data/audio/grist/raw/<fileIdent>
 * (if missing) and return the audio-root-relative path. Used by the track
 * loader (ffmpeg input) and the editor's un-trimmed audio preview.
 */
export async function cacheRawAttachment(
  g: GristClient,
  attId: number,
  fileIdent: string,
): Promise<string> {
  if (fileIdent === "") fileIdent = `${attId}.bin`;
  const rel = join("grist", "raw", fileIdent);
  const full = join(dataDir(), "audio", rel);

  try {
    await stat(full);
    return rel;
  } catch {
    // not cached yet
  }
  await mkdir(dirname(full), { recursive: true });
  const data = await g.downloadAttachment(attId);
  await writeFile(full, data);
  console.log(
    `[Grist] Cached raw attachment ${attId} → ${full} (${data.length} bytes)`,
  );
  return rel;
}

/**
 * Trim the resolved [from, to] window out of `in` and re-encode as
 * libopus@64k/webm at `out`. `-ss` before `-i` for the fast keyframe-snapped
 * seek — fine for blind-test snippets.
 */
export async function transcodeOpusWebm(
  inPath: string,
  outPath: string,
  fromSec: number,
  toSec: number,
): Promise<void> {
  [fromSec, toSec] = resolveTrim(fromSec, toSec);
  const args = ["-y", "-loglevel", "error", "-nostdin"];
  if (fromSec > 0) args.push("-ss", String(fromSec));
  args.push(
    "-i",
    inPath,
    "-t",
    String(toSec - fromSec),
    "-vn",
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    outPath,
  );
  try {
    await execFileP("ffmpeg", args);
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT")
      throw new Error(`ffmpeg not installed: ${e.message}`);
    throw new Error(`ffmpeg failed: ${(e.stderr ?? e.message ?? "").trim()}`);
  }
}

// Re-exported for the editor's preview endpoint (reads the raw cache).
export async function readRawAttachment(rel: string): Promise<Buffer> {
  return readFile(join(dataDir(), "audio", rel));
}
