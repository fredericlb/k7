// songbook.ts — a song's lyrics, tablature and sheets, kept IN its library folder beside the master,
// with its songbook bookkeeping in the sidecar's `songbook:` section. A song is a songbook song when
// it carries one of the three. What reads wrong: the id is the sidecar's `uuid`, never the path,
// since a song's folder can change while its id cannot — docs/songbook.md.

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { hasTimecodes, timeFromSheet } from "@studio/lyrics/lrc";
import { MEDIA_YAML_READ } from "@studio/song-schema/mediaYaml";
import { type Document, isMap, parseDocument } from "yaml";
import { listFamilyFresh } from "./catalogue.ts";
import { writablePath } from "./layout.ts";
import { masterName, segment, songFolder } from "./song.ts";
import { readMasterTags, writeMasterTags } from "./tags.ts";
import {
  CHORDS_FILE,
  LYRICS_FILE,
  SHEETS_DIR,
  SONG_FILE,
  type SongbookFacts,
  type SongbookSheet,
  type SongbookSong,
  TABS_FILE,
} from "./types.ts";
import {
  existingMaster,
  familyOf,
  type OnDisk,
  putFile,
  removeFile,
} from "./write.ts";

/** A songbook request the library refuses — no such song, a folder that is not one, a target already taken; a 4xx. */
export class SongbookRefusedError extends Error {}

/** The sidecar keys that name a song while its folder holds no audio; a master's tags replace them. */
const FALLBACK = ["title", "artist"] as const;

/** A song folder's sidecar as an editable document — comments kept, which a parse-and-dump would drop. */
export function sidecarDoc(rel: string): Document {
  let text = "";
  try {
    text = readFileSync(writablePath(`${rel}/${SONG_FILE}`), "utf8");
  } catch {
    // No sidecar yet: the first write files the folder.
  }
  const doc = parseDocument(text, MEDIA_YAML_READ);
  if (!isMap(doc.contents)) doc.contents = doc.createNode({}) as never;
  return doc;
}

export function writeSidecar(rel: string, doc: Document): void {
  putFile(`${rel}/${SONG_FILE}`, doc.toString());
}

/** The sidecar as plain data, `{}` for none or an unreadable one. */
function sidecarData(rel: string): Record<string, unknown> {
  const v = sidecarDoc(rel).toJS();
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The `songbook:` section as facts, every field defaulted. */
function factsOf(data: Record<string, unknown>): SongbookFacts {
  const b = (
    data.songbook && typeof data.songbook === "object" ? data.songbook : {}
  ) as Record<string, unknown>;
  const f = (b.fetch && typeof b.fetch === "object" ? b.fetch : {}) as Record<
    string,
    unknown
  >;
  const sheets = Array.isArray(b.sheets)
    ? (b.sheets as Record<string, unknown>[])
        .filter((s) => s && str(s.id) && str(s.file))
        .map((s) => ({
          id: str(s.id),
          file: str(s.file),
          name: str(s.name) || basename(str(s.file)),
          mime: str(s.mime),
        }))
    : [];
  return {
    owner: str(b.owner),
    createdAt: str(b.createdAt),
    origin: str(b.origin),
    lyricsMatch: str(b.lyricsMatch),
    chordsMatch: str(b.chordsMatch),
    fetchIgnored: b.fetchIgnored === true,
    fetch: {
      phase: str(f.phase),
      progress: typeof f.progress === "number" ? f.progress : null,
      error: str(f.error),
      huntId: str(f.huntId),
      jobId: str(f.jobId),
    },
    instrumental: str(b.instrumental),
    sheets,
  };
}

function readText(rel: string, name: string): string {
  try {
    return readFileSync(writablePath(`${rel}/${name}`), "utf8");
  } catch {
    return "";
  }
}

/** A text attachment written, or removed when empty: an empty file would still make it a songbook song. */
function writeText(rel: string, name: string, text: string): void {
  if (text.trim()) putFile(`${rel}/${name}`, text);
  else removeFile(`${rel}/${name}`);
}

/** The folder a songbook id names, from the listing — null when no song carries it. */
export async function songbookFolder(id: string): Promise<string | null> {
  if (!id) return null;
  const { entries } = await listFamilyFresh("songs");
  return entries.find((e) => e.meta?.uuid === id)?.path ?? null;
}

async function folderOrRefuse(id: string): Promise<string> {
  const rel = await songbookFolder(id);
  if (!rel) throw new SongbookRefusedError(`no song ${id}`);
  return rel;
}

/** A song's displayed names: the master's tags, else the sidecar's fallback, else the folder's own segments. */
async function namesOf(
  rel: string,
  data: Record<string, unknown>,
): Promise<{ artist: string; title: string; master: string | null }> {
  const name = existingMaster(writablePath(rel));
  const tags = name ? await readMasterTags(writablePath(`${rel}/${name}`)) : {};
  const parts = rel.split("/");
  return {
    artist: tags.artist || str(data.artist) || parts[1] || "",
    title: tags.title || str(data.title) || parts[parts.length - 1] || "",
    master: name ? `${rel}/${name}` : null,
  };
}

/** A songbook song read whole, by its id; null when no folder carries it. */
export async function readSongbook(id: string): Promise<SongbookSong | null> {
  const rel = await songbookFolder(id);
  return rel ? readSongbookAt(rel) : null;
}

/** …and by its folder, for a caller that already holds it. */
export async function readSongbookAt(rel: string): Promise<SongbookSong> {
  const data = sidecarData(rel);
  const names = await namesOf(rel, data);
  return {
    id: str(data.uuid),
    path: rel,
    ...names,
    lyrics: readText(rel, LYRICS_FILE),
    tablature: readText(rel, TABS_FILE),
    chords: readText(rel, CHORDS_FILE),
    facts: factsOf(data),
  };
}

/** A free folder for these names: the one the tags build, then ` (2)`, ` (3)`… when a songbook song is already there. */
function freeFolder(artist: string, title: string): string {
  const base = songFolder({ artist, title });
  for (let n = 1; ; n++) {
    const rel = n === 1 ? base : `${base} (${n})`;
    if (!str(sidecarData(rel).uuid)) return rel;
  }
}

/** A new songbook song, filed where an upload of the same names would land — a folder there without one is adopted. */
export function createSongbook(opts: {
  artist: string;
  title: string;
  owner: string;
  /** Kept when given — a migration or a copy carries the song's existing id. */
  id?: string;
  createdAt?: string;
  /** A folder to use instead of the derived one: a library song the songbook song becomes. */
  folder?: string;
}): { id: string; path: string } {
  const rel = opts.folder ?? freeFolder(opts.artist, opts.title);
  if (familyOf(rel) !== "songs")
    throw new SongbookRefusedError(`${rel} is not a song folder`);
  const id = opts.id || randomUUID();
  const doc = sidecarDoc(rel);
  const taken = str(doc.get("uuid"));
  if (taken && taken !== id)
    throw new SongbookRefusedError(`${rel} is already the song ${taken}`);
  doc.set("uuid", id);
  if (!doc.has("source")) doc.set("source", "k7");
  // No audio, so no tags: the sidecar names the song until a master arrives.
  if (!existingMaster(writablePath(rel))) {
    doc.set("title", opts.title);
    doc.set("artist", opts.artist);
  }
  doc.setIn(["songbook", "owner"], opts.owner);
  doc.setIn(
    ["songbook", "createdAt"],
    opts.createdAt || new Date().toISOString(),
  );
  writeSidecar(rel, doc);
  return { id, path: rel };
}

/** What a songbook edit may change; a field absent is kept. */
export interface SongbookPatch {
  artist?: string;
  title?: string;
  lyrics?: string;
  tablature?: string;
  chords?: string;
  lyricsMatch?: string;
  fetchIgnored?: boolean;
  fetch?: Partial<SongbookFacts["fetch"]>;
  instrumental?: string;
  origin?: string;
}

/** Apply an edit: names go to the master's tags (or the sidecar while there is none), texts to their files. */
export async function patchSongbook(
  id: string,
  patch: SongbookPatch,
): Promise<SongbookSong> {
  const rel = await folderOrRefuse(id);
  if (patch.lyrics !== undefined) writeText(rel, LYRICS_FILE, patch.lyrics);
  if (patch.tablature !== undefined) writeText(rel, TABS_FILE, patch.tablature);
  if (patch.chords !== undefined) writeText(rel, CHORDS_FILE, patch.chords);
  // Either text changed: the chords take the lyrics' times again.
  if (patch.chords !== undefined || patch.lyrics !== undefined)
    timeChordsAt(rel);
  const master = existingMaster(writablePath(rel));
  if (master && (patch.artist !== undefined || patch.title !== undefined))
    await writeMasterTags(writablePath(`${rel}/${master}`), {
      ...(patch.artist !== undefined ? { artist: patch.artist } : {}),
      ...(patch.title !== undefined ? { title: patch.title } : {}),
    });
  const doc = sidecarDoc(rel);
  if (!master) {
    if (patch.artist !== undefined) doc.set("artist", patch.artist);
    if (patch.title !== undefined) doc.set("title", patch.title);
  }
  const set = (key: string, v: unknown) => {
    if (v === "" || v === false || v === null) doc.deleteIn(["songbook", key]);
    else doc.setIn(["songbook", key], v);
  };
  if (patch.lyricsMatch !== undefined) set("lyricsMatch", patch.lyricsMatch);
  if (patch.fetchIgnored !== undefined) set("fetchIgnored", patch.fetchIgnored);
  if (patch.instrumental !== undefined) set("instrumental", patch.instrumental);
  if (patch.origin !== undefined) set("origin", patch.origin);
  if (patch.fetch)
    for (const [k, v] of Object.entries(patch.fetch)) {
      if (v === undefined) continue;
      if (v === "" || v === null) doc.deleteIn(["songbook", "fetch", k]);
      else doc.setIn(["songbook", "fetch", k], v);
    }
  writeSidecar(rel, doc);
  return readSongbookAt(rel);
}

/** A sheet's file name in `sheets/`: the upload's own, made nameable, and never one already there. */
function sheetFile(rel: string, name: string): string {
  const ext = extname(name).toLowerCase().slice(0, 12);
  const stem = segment(
    name.slice(0, name.length - extname(name).length),
    "sheet",
  );
  for (let n = 1; ; n++) {
    const file = `${SHEETS_DIR}/${n === 1 ? stem : `${stem} ${n}`}${ext}`;
    if (!existsSync(writablePath(`${rel}/${file}`))) return file;
  }
}

/** Add one sheet after the others: the bytes into `sheets/`, then the line that orders and names it. */
export async function addSongbookSheet(
  id: string,
  sheet: { bytes: Uint8Array | OnDisk; name: string; mime: string },
): Promise<SongbookSong> {
  const rel = await folderOrRefuse(id);
  return addSheetAt(rel, sheet);
}

/** …by folder, for a migration that has not listed the library yet. */
export function addSheetAt(
  rel: string,
  sheet: {
    bytes: Uint8Array | OnDisk;
    name: string;
    mime: string;
    id?: string;
  },
): Promise<SongbookSong> {
  const file = sheetFile(rel, sheet.name || "sheet");
  putFile(`${rel}/${file}`, sheet.bytes);
  const doc = sidecarDoc(rel);
  const entry: SongbookSheet = {
    id: sheet.id || randomUUID().slice(0, 12),
    file,
    name: sheet.name || basename(file),
    mime: sheet.mime,
  };
  const list = factsOf(doc.toJS() ?? {}).sheets;
  doc.setIn(["songbook", "sheets"], [...list, entry]);
  writeSidecar(rel, doc);
  return readSongbookAt(rel);
}

/** Remove one sheet: its line first, so a crash leaves a stray file and never a line naming nothing. */
export async function removeSongbookSheet(
  id: string,
  sheetId: string,
): Promise<SongbookSong> {
  const rel = await folderOrRefuse(id);
  const doc = sidecarDoc(rel);
  const list = factsOf(doc.toJS() ?? {}).sheets;
  const gone = list.find((s) => s.id === sheetId);
  if (!gone) return readSongbookAt(rel);
  const rest = list.filter((s) => s.id !== sheetId);
  if (rest.length) doc.setIn(["songbook", "sheets"], rest);
  else doc.deleteIn(["songbook", "sheets"]);
  writeSidecar(rel, doc);
  removeFile(`${rel}/${gone.file}`);
  return readSongbookAt(rel);
}

/** Write the lyrics and tablature by folder — what a migration does before the listing knows the id. */
export function writeTextsAt(
  rel: string,
  texts: { lyrics?: string; tablature?: string },
): void {
  if (texts.lyrics !== undefined) writeText(rel, LYRICS_FILE, texts.lyrics);
  if (texts.tablature !== undefined) writeText(rel, TABS_FILE, texts.tablature);
  // Lyrics found or migrated in: chords already typed take their times.
  if (texts.lyrics !== undefined) timeChordsAt(rel);
}

/**
 * The CHORDS timed from the LYRICS: each sung line of the chords takes the time of the lyrics line it
 * matches, as rehearsal times lyrics from an LRC (@studio/lyrics `timeFromSheet`). Run after every
 * write of either text. Lyrics with no code time nothing, and the chords keep what was typed.
 */
export function timeChordsAt(rel: string): void {
  const chords = readText(rel, CHORDS_FILE);
  const lyrics = readText(rel, LYRICS_FILE);
  const doc = sidecarDoc(rel);
  let match = "";
  if (chords.trim() && hasTimecodes(lyrics)) {
    const timed = timeFromSheet(chords, lyrics);
    if (timed.ok && timed.placed > 0) {
      if (timed.lyrics !== chords) writeText(rel, CHORDS_FILE, timed.lyrics);
      match = "matched";
    } else match = "unmatched";
  }
  if (match) doc.setIn(["songbook", "chordsMatch"], match);
  else doc.deleteIn(["songbook", "chordsMatch"]);
  writeSidecar(rel, doc);
}

/** Set the songbook facts by folder, for the same caller. */
export function setFactsAt(rel: string, facts: Partial<SongbookFacts>): void {
  const doc = sidecarDoc(rel);
  for (const [k, v] of Object.entries(facts)) {
    if (k === "sheets") continue;
    if (v === "" || v === false || v === null || v === undefined) continue;
    doc.setIn(["songbook", k], v);
  }
  writeSidecar(rel, doc);
}

/** Give a songbook song its reference track: the master of ITS folder, replaced, tagged with its names. */
export async function setSongbookMaster(
  id: string,
  upload: { filename: string; bytes: Uint8Array | OnDisk },
): Promise<SongbookSong> {
  const rel = await folderOrRefuse(id);
  const name = masterName(upload.filename);
  const before = await readSongbookAt(rel);
  const old = existingMaster(writablePath(rel));
  const abs = putFile(`${rel}/${name}`, upload.bytes);
  if (old && old !== name) removeFile(`${rel}/${old}`, name);
  try {
    await writeMasterTags(abs, { artist: before.artist, title: before.title });
  } catch {
    // An untaggable file still plays; its names stay in the sidecar below.
    return readSongbookAt(rel);
  }
  // The tags carry the names now: the sidecar's copies would only disagree with them.
  const doc = sidecarDoc(rel);
  for (const k of FALLBACK) doc.delete(k);
  writeSidecar(rel, doc);
  return readSongbookAt(rel);
}
