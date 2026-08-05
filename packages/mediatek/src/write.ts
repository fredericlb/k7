// write.ts — putting a file into the library and taking one out, on whichever side owns
// it. Bumps the family's mutation counter, because a write the walk cannot see (same file
// count, same tick) is exactly the case the counter exists for. See docs/index.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ensureLayout,
  mediatekDir,
  RECORDINGS_DIR,
  writablePath,
} from "./layout.ts";
import { isAudio } from "./media.ts";
import { bumped } from "./revision.ts";
import { SONG_FILE } from "./scan.ts";
import {
  masterName,
  SongExistsError,
  type SongTags,
  sidecarFor,
  songFolder,
  VariantRefusedError,
  variantFile,
  variantName,
} from "./song.ts";
import { FAMILIES, type Family } from "./types.ts";

/** Which family a path belongs to, or null for the shared `library`/`ui` folders and
 *  anything else — those have no token of their own. */
export function familyOf(rel: string): Family | null {
  const top = rel.split(/[\\/]+/)[0];
  return FAMILIES.includes(top as Family) ? (top as Family) : null;
}

/**
 * Write one file, creating its folder.
 *
 * Written beside and renamed, like the cache's downloads and for the same reason: the
 * moteur may be reading this tree, and a half-written module.yaml is a project that will
 * not compile.
 */
export function putFile(rel: string, body: Uint8Array | string): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.part`;
  writeFileSync(tmp, body);
  renameSync(tmp, abs);
  bump(abs);
  return abs;
}

/** Remove one file. Absent is success: the caller wanted it gone. */
export function removeFile(rel: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { force: true });
  bump(abs);
}

/**
 * Move or rename, ATOMICALLY, and for a folder as readily as a file.
 *
 * Composing this from read + write + delete on the client was the previous answer, and it
 * had two faults this does not: a folder cannot be read as bytes at all, and a failure
 * between the write and the delete leaves a duplicate. `renameSync` is one syscall on the
 * same volume, so the tree is never in a state where the entry exists twice or not at all.
 *
 * BOTH ends are bumped: a move between families changes two listings, and revving only the
 * destination would leave the source's catalogue showing something that is no longer there.
 */
export function moveEntry(from: string, to: string): void {
  ensureLayout();
  const src = writablePath(from);
  const dst = writablePath(to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
  bump(src);
  bump(dst);
}

/** An empty folder. The scan ignores it until something lands in it, which is the point:
 *  somewhere to drop into that exists before the first file does. */
export function makeFolder(rel: string): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(abs, { recursive: true });
  bump(abs);
  return abs;
}

/** Remove a whole subtree. Absent is success, as for a single file. */
export function removeTree(rel: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { recursive: true, force: true });
  bump(abs);
}

/** The audio file already sitting in a song folder, or null for a folder that has none
 *  — including one that is not there at all, which is the ordinary case. */
function existingMaster(abs: string): string | null {
  try {
    return readdirSync(abs).find((n) => isAudio(n)) ?? null;
  } catch {
    return null;
  }
}

/** Is this folder ALREADY a song? The scan's own test, asked of one folder: a sidecar, or
 *  failing that any audio — an uncatalogued morceau is still a morceau (see scan.ts). */
function isSongFolder(abs: string): boolean {
  return existsSync(join(abs, SONG_FILE)) || existingMaster(abs) !== null;
}

/**
 * File one uploaded audio file as a song: the folder, the master, the sidecar.
 *
 * `songs/` is the one family nobody edits by hand — its shape is derived from the three
 * tags, not typed — so this is the way in. The tags are what the caller confirmed, never a
 * path the caller built: a client that could name the folder could name any folder.
 *
 * There is no `kind` any more: the folder is `songs/<artist>/<album>/<title>`, full stop.
 * k7 used to pass `recorded` here to file a published version apart from an upload, and that
 * distinction now costs nothing to drop — raw capture is the `recordings/` zone, and what
 * reaches this function is catalogued work whichever surface sent it.
 *
 * The sidecar is written LAST, as the mirror does and for the same reason: a crash then
 * leaves an uncatalogued folder rather than a catalogue entry pointing at nothing.
 */
export function addSong(opts: {
  filename: string;
  bytes: Uint8Array;
  tags: SongTags;
  /** Replace the master already there. Absent, an occupied folder is a refusal — a silent
   *  clobber is the one outcome the person uploading cannot undo. */
  replace?: boolean;
}): { path: string; master: string; replaced: boolean } {
  const folder = songFolder(opts.tags);
  const name = masterName(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const already = existingMaster(writablePath(folder));
  if (already && !opts.replace)
    throw new SongExistsError(`${folder} already holds ${already}`);
  putFile(`${folder}/${name}`, opts.bytes);
  // A replacement in another format would otherwise leave two masters, and the scan picks
  // whichever readdir hands it first.
  if (already && already !== name) removeFile(`${folder}/${already}`);
  putFile(`${folder}/${SONG_FILE}`, sidecarFor(opts.tags));
  return {
    path: folder,
    master: `${folder}/${name}`,
    replaced: Boolean(already),
  };
}

/**
 * The `variants:` a sidecar already declares, as the scan would read them.
 *
 * `null` is NOT "none": it means the key is there and is not a mapping — a list, a scalar —
 * which the scan ignores and this cannot complete. Adding a mapping line under a list would
 * make the whole file unparseable, and an unparseable sidecar costs the song its title.
 */
function declaredVariants(text: string): Record<string, string> | null {
  let raw: unknown;
  try {
    const doc = parseYaml(text, { version: "1.2" }) as Record<
      string,
      unknown
    > | null;
    raw = doc && typeof doc === "object" ? doc.variants : undefined;
  } catch {
    return {}; // unparseable already: nothing is declared, and the insert below is text-level
  }
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  // Same tolerance readVariants has: a non-string value is dropped, not coerced.
  for (const [k, v] of Object.entries(raw as Record<string, unknown>))
    if (typeof v === "string" && v) out[k] = v;
  return out;
}

/** A name no other variant of this song is using — `instrumental`, then `instrumental 2`. */
function freeName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++)
    if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

/**
 * The sidecar text with one more variant line in it.
 *
 * Read with the parser, written as TEXT — the same split `setSongBpm` makes, for the same
 * reason: the header comments say how the tree is derived, and a round trip through the
 * serialiser would drop them. Both the key and the ref are quoted, as `sidecarFor` quotes
 * every string a person supplied: a variant called `no` or `12:30` is otherwise a boolean
 * and a sexagesimal.
 *
 * `null` for a block this cannot append a LINE to — one written inline, `variants: {a: b}`.
 * The parser reads that as a perfectly good mapping, so only the text can tell, and a line
 * pushed under it would make the whole file unparseable.
 */
function withVariant(text: string, name: string, ref: string): string | null {
  const line = `  ${JSON.stringify(name)}: ${JSON.stringify(ref)}`;
  const head = !text || text.endsWith("\n") ? text : `${text}\n`;
  const lines = head.split("\n");
  const at = lines.findIndex((l) => /^variants\s*:/.test(l));
  if (at >= 0) {
    const rest = lines[at].replace(/^variants\s*:/, "").trim();
    if (rest && !rest.startsWith("#")) return null;
  }
  // No block yet — open one at the end. A sidecar that does not exist at all becomes one,
  // which is the only way the variant is ever seen: the scan reads variants from this file
  // and from nowhere else.
  if (at < 0)
    return `${head || `# ${SONG_FILE} — voir packages/mediatek/docs/variants.md\n`}variants:\n${line}\n`;
  // At the END of the block, not straight under its header: the order in the file is the
  // order they were added, and a surface listing them shows the newest last rather than
  // reshuffling what was there. A blank line does not close the block; an unindented one does.
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (!/^\s/.test(lines[i])) break;
    end = i;
  }
  lines.splice(end + 1, 0, line);
  return lines.join("\n");
}

/**
 * Add an uploaded audio file to an existing song as one of its VARIANTS: the bytes beside the
 * master, and the line in the sidecar that makes them one. Answers what it wrote.
 *
 * The caller names the FOLDER here, unlike `addSong` which derives one from three tags. That
 * is not a hole in the same rule: the rule is that nobody invents a place in `songs/`, and
 * this one has to already exist and already be a song — a folder holding neither master nor
 * sidecar is refused rather than filled. See docs/variants.md.
 *
 * Re-sending a file already declared replaces its BYTES and touches nothing else: the sidecar
 * line is the same line, and a second one pointing at the same ref would draw the variant
 * twice.
 */
export function addSongVariant(opts: {
  /** The song's own folder, mediatek-relative — `songs/<artiste>/<album>/<titre>`. */
  folder: string;
  filename: string;
  bytes: Uint8Array;
  /** What the sidecar will call it. Absent, the file's own stem. */
  name?: string;
}): { path: string; ref: string; name: string; declared: boolean } {
  const folder = opts.folder.replace(/\/+$/, "");
  const ref = variantFile(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const abs = writablePath(folder);
  // It has to BE a song already. `songs/` is the one family whose shape is derived rather
  // than typed, and a drop that created `songs/whatever/` would be exactly the hand-made
  // folder at the wrong level that docs/songs.md refuses.
  if (familyOf(folder) !== "songs" || !isSongFolder(abs))
    throw new VariantRefusedError(`${folder} n'est pas un morceau`);
  const sidecar = writablePath(`${folder}/${SONG_FILE}`);
  let text: string;
  try {
    text = readFileSync(sidecar, "utf8");
  } catch {
    text = ""; // an uncatalogued folder: the first variant is what files it
  }
  const declared = declaredVariants(text);
  // Already declared, under whatever name it was given: only the bytes are new.
  const already =
    declared &&
    Object.entries(declared).find(
      ([, r]) => r.toLowerCase() === ref.toLowerCase(),
    );
  const name = already
    ? already[0]
    : freeName(
        opts.name || variantName(opts.filename),
        new Set(Object.keys(declared ?? {})),
      );
  // The whole edit is computed BEFORE a byte lands: a sidecar this cannot complete is a
  // refusal, and a refusal must not leave an audio file nothing points at behind it.
  const next = already ? null : declared && withVariant(text, name, ref);
  if (!already && !next)
    throw new VariantRefusedError(
      `${folder}/${SONG_FILE} déclare « variants: » sous une forme que ceci ne sait pas compléter — corrigez-la dans l'éditeur`,
    );
  putFile(`${folder}/${ref}`, opts.bytes);
  // The sidecar LAST, as addSong writes it last: a crash then leaves an audio file nothing
  // points at, rather than a line pointing at bytes that never landed.
  if (next) putFile(`${folder}/${SONG_FILE}`, next);
  return { path: `${folder}/${ref}`, ref, name, declared: !already };
}

/**
 * Seed a song's detected tempo into its sidecar. Answers whether it wrote.
 *
 * NEVER overwrites: `bpm` is a field a person edits, and a detected value is only ever a
 * starting point (the engine's estimate halves an octave on fast material — see
 * packages/file-service/docs/waveformCache.md). Re-analysing a song must not undo a
 * correction, so an existing key — whatever its value — wins.
 *
 * A `bpm` of 0 is the engine's "no tempo found" and writes nothing: an explicit zero in the
 * file would read as a claim, and the absence is the honest state.
 */
export function setSongBpm(folder: string, bpm: number): boolean {
  if (!(bpm > 0)) return false;
  const abs = writablePath(`${folder}/${SONG_FILE}`);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return false; // no sidecar: the folder is not catalogued, and this does not catalogue it
  }
  // A line-level check, not a YAML parse-and-rewrite: the sidecar carries comments that say
  // how the tree is derived, and a round trip through the parser would drop them.
  if (/^\s*bpm\s*:/m.test(text)) return false;
  writeFileSync(
    abs,
    `${text.endsWith("\n") ? text : `${text}\n`}bpm: ${bpm}\n`,
    "utf8",
  );
  bump(abs);
  return true;
}

/** Rev the family or zone a path belongs to, so the next poll refetches its listing. */
function bump(abs: string): void {
  const path = relative(mediatekDir(), abs).split(sep).join("/");
  const fam = familyOf(path);
  if (fam) bumped(fam);
  // Not a family, but a zone with a surface polling it — see docs/recordings.md.
  else if (path.startsWith(`${RECORDINGS_DIR}/`)) bumped(RECORDINGS_DIR);
}
