// write.ts — putting a file into the library and taking one out, on whichever side owns
// it. Bumps the family's mutation counter, because a write the walk cannot see (same file
// count, same tick) is exactly the case the counter exists for. See docs/index.md.

import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { MEDIA_YAML_READ } from "@studio/song-schema/mediaYaml";
import { parse as parseYaml } from "yaml";
import {
  ensureLayout,
  mediatekDir,
  RECORDINGS_DIR,
  writablePath,
} from "./layout.ts";
import { derivedNamesOf, isAudio, withoutDerived } from "./media.ts";
import { placeFileSync } from "./place.ts";
import { bumped } from "./revision.ts";
import { SONG_FILE } from "./scan.ts";
import {
  masterName,
  SongExistsError,
  type SongTags,
  sidecarFor,
  songFolder,
  TagsRefusedError,
  VariantRefusedError,
  variantFile,
  variantName,
} from "./song.ts";
import { readMasterTags, UntaggableError, writeMasterTags } from "./tags.ts";
import {
  FAMILIES,
  type Family,
  KEY_PATTERN,
  type MasterTags,
} from "./types.ts";

/** Which family a path belongs to, or null — the shared folders have no token of their own. */
export function familyOf(rel: string): Family | null {
  const top = rel.split(/[\\/]+/)[0];
  return FAMILIES.includes(top as Family) ? (top as Family) : null;
}

/** An upload already on disk, MOVED into place — the caller's file is gone once written (docs/index.md). */
export interface OnDisk {
  file: string;
}

/** What a write takes: bytes in memory, or a file a server streamed a request body into. */
export type FileBody = Uint8Array | string | OnDisk;

/** Whether a body is a file to move rather than bytes to write. */
export const isOnDisk = (b: FileBody): b is OnDisk =>
  typeof b === "object" && !(b instanceof Uint8Array);

/** Move a file, copying when it sits on another device — a rename cannot cross one. */
export function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}

/** Write one file, creating its folder — beside then renamed, because the moteur may be reading. */
export function putFile(rel: string, body: FileBody): string {
  ensureLayout();
  const abs = writablePath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  // A random suffix: two writers targeting the same path (separate processes sharing this
  // volume) must never share one temp name.
  const tmp = `${abs}.${randomUUID()}.part`;
  try {
    if (isOnDisk(body)) moveFile(body.file, tmp);
    else writeFileSync(tmp, body);
    // A master replaced while the engine plays it is refused on Windows — docs/rename.md.
    placeFileSync(tmp, abs);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  bump(abs);
  return abs;
}

/** Remove one file, and a FLAC's derived copies with it, but `keep` — the new master written over one. Absent is success. */
export function removeFile(rel: string, keep?: string): void {
  const abs = writablePath(rel);
  rmSync(abs, { force: true });
  // Left behind, a derived copy would surface as an ordinary file — docs/derived.md.
  for (const derived of derivedNamesOf(abs))
    if (basename(derived) !== keep) rmSync(derived, { force: true });
  bump(abs);
}

/** Move or rename ATOMICALLY, a folder as readily as a file, revving BOTH ends — see docs/index.md. */
export function moveEntry(from: string, to: string): void {
  ensureLayout();
  const src = writablePath(from);
  const dst = writablePath(to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
  followDerived(src, dst);
  bump(src);
  bump(dst);
}

/** A moved FLAC takes its derived copies along; renamed to anything else, they are dropped. */
function followDerived(src: string, dst: string): void {
  const to = derivedNamesOf(dst);
  derivedNamesOf(src).forEach((from, i) => {
    if (!existsSync(from)) return;
    if (to[i]) renameSync(from, to[i]);
    else rmSync(from, { force: true });
  });
}

/** An empty folder — somewhere to drop into that exists before the first file does. */
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

/** The audio file already in a song folder, or null — a folder that is not there is the usual case. */
function existingMaster(abs: string): string | null {
  try {
    const names = readdirSync(abs).map((name) => ({ name }));
    return withoutDerived(names).find((e) => isAudio(e.name))?.name ?? null;
  } catch {
    return null;
  }
}

/** Is this folder ALREADY a song? A sidecar, or failing that any audio — the scan's own test. */
function isSongFolder(abs: string): boolean {
  return existsSync(join(abs, SONG_FILE)) || existingMaster(abs) !== null;
}

/** File one uploaded audio file as a song: the folder, the master and its tags, the sidecar — see docs/songs.md. */
export async function addSong(opts: {
  filename: string;
  bytes: Uint8Array | OnDisk;
  tags: SongTags;
  /** Replace the master already there. Absent, an occupied folder is a refusal, not a clobber. */
  replace?: boolean;
}): Promise<{
  path: string;
  master: string;
  replaced: boolean;
  /** False when TagLib could not write into this file: it is filed all the same, named by its folder. */
  tagged: boolean;
}> {
  const folder = songFolder(opts.tags);
  const name = masterName(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const already = existingMaster(writablePath(folder));
  if (already && !opts.replace)
    throw new SongExistsError(`${folder} already holds ${already}`);
  const master = putFile(`${folder}/${name}`, opts.bytes);
  // A replacement in another format would otherwise leave two masters for the scan to pick from.
  // A FLAC replaced by a WebM or an MP3 keeps it: it is the new master, written over a derived one.
  if (already && already !== name) removeFile(`${folder}/${already}`, name);
  // Only what was given: a field the caller left blank keeps whatever the file already says.
  const given: Partial<Record<keyof MasterTags, string>> = {};
  for (const f of ["title", "artist", "album"] as const)
    if (opts.tags[f]?.trim()) given[f] = opts.tags[f];
  let tagged = true;
  try {
    await writeMasterTags(master, given);
    bump(master);
  } catch (e) {
    if (!(e instanceof UntaggableError)) throw e;
    tagged = false;
  }
  putFile(`${folder}/${SONG_FILE}`, sidecarFor(opts.tags.source));
  return {
    path: folder,
    master: `${folder}/${name}`,
    replaced: Boolean(already),
    tagged,
  };
}

/** Rewrite a song's tags — the editor's door; the folder keeps its name, since it is only an address (docs/songs.md). */
export async function setSongTags(
  folder: string,
  patch: Partial<Record<keyof MasterTags, string | number | undefined>>,
): Promise<{ master: string; tags: MasterTags }> {
  const rel = folder.replace(/\/+$/, "");
  const name = existingMaster(writablePath(rel));
  if (familyOf(rel) !== "songs" || !name)
    throw new TagsRefusedError(`${rel} n'a pas de master à étiqueter`);
  if (patch.key && !KEY_PATTERN.test(String(patch.key).trim()))
    throw new TagsRefusedError(
      `key must read like \`C# minor\` or \`A major\``,
    );
  const abs = writablePath(`${rel}/${name}`);
  const tags = await writeMasterTags(abs, patch);
  bump(abs);
  return { master: `${rel}/${name}`, tags };
}

/** The `variants:` a sidecar declares; `null` means the key is there and is not a mapping, which this refuses rather than repairs — see docs/variants.md. */
function declaredVariants(text: string): Record<string, string> | null {
  let raw: unknown;
  try {
    const doc = parseYaml(text, MEDIA_YAML_READ) as Record<
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

/** The sidecar text with one more variant line, edited as TEXT and quoted; `null` for an inline block no line can be appended to — see docs/variants.md. */
function withVariant(text: string, name: string, ref: string): string | null {
  const line = `  ${JSON.stringify(name)}: ${JSON.stringify(ref)}`;
  const head = !text || text.endsWith("\n") ? text : `${text}\n`;
  const lines = head.split("\n");
  const at = lines.findIndex((l) => /^variants\s*:/.test(l));
  if (at >= 0) {
    const rest = lines[at].replace(/^variants\s*:/, "").trim();
    if (rest && !rest.startsWith("#")) return null;
  }
  // No block yet — open one at the end, creating the sidecar itself if there is none.
  if (at < 0)
    return `${head || `# ${SONG_FILE} — voir packages/mediatek/docs/variants.md\n`}variants:\n${line}\n`;
  // At the END of the block, so the file's order is the order they were added; an unindented line closes it.
  let end = at;
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (!/^\s/.test(lines[i])) break;
    end = i;
  }
  lines.splice(end + 1, 0, line);
  return lines.join("\n");
}

/** The sidecar text with one variant's line gone; `null` for an inline block, the same refusal adding one gives — see docs/variants.md. */
function withoutVariant(text: string, name: string): string | null {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^variants\s*:/.test(l));
  if (at < 0) return null;
  const rest = lines[at].replace(/^variants\s*:/, "").trim();
  if (rest && !rest.startsWith("#")) return null;
  for (let i = at + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (!/^\s/.test(lines[i])) break;
    let key: string | undefined;
    try {
      key = Object.keys(
        (parseYaml(lines[i]) as Record<string, unknown>) ?? {},
      )[0];
    } catch {
      continue;
    }
    if (key === name) {
      lines.splice(i, 1);
      return lines.join("\n");
    }
  }
  return null;
}

/** Add an uploaded file to an existing song as a VARIANT: the bytes beside the master, and the sidecar line that makes them one — see docs/variants.md. */
export function addSongVariant(opts: {
  /** The song's own folder, mediatek-relative — `songs/<artiste>/<album>/<titre>`. */
  folder: string;
  filename: string;
  bytes: Uint8Array | OnDisk;
  /** What the sidecar will call it. Absent, the file's own stem. */
  name?: string;
}): { path: string; ref: string; name: string; declared: boolean } {
  const folder = opts.folder.replace(/\/+$/, "");
  const ref = variantFile(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const abs = writablePath(folder);
  // It has to BE a song already: nobody invents a place in `songs/` (docs/songs.md).
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
  // The whole edit is computed BEFORE a byte lands, so a refusal leaves no audio nothing points at.
  const next = already ? null : declared && withVariant(text, name, ref);
  if (!already && !next)
    throw new VariantRefusedError(
      `${folder}/${SONG_FILE} déclare « variants: » sous une forme que ceci ne sait pas compléter — corrigez-la dans l'éditeur`,
    );
  putFile(`${folder}/${ref}`, opts.bytes);
  // The sidecar LAST, as addSong writes it last: a crash leaves orphan bytes, not a dead line.
  if (next) putFile(`${folder}/${SONG_FILE}`, next);
  return { path: `${folder}/${ref}`, ref, name, declared: !already };
}

/** Remove a song's variant: the sidecar first, so a crash leaves an orphan FILE and not a dead line — see docs/variants.md. */
export function removeSongVariant(folder: string, name: string): void {
  const rel = folder.replace(/\/+$/, "");
  const sidecar = writablePath(`${rel}/${SONG_FILE}`);
  let text: string;
  try {
    text = readFileSync(sidecar, "utf8");
  } catch {
    throw new VariantRefusedError(`${rel} n'est pas un morceau`);
  }
  const declared = declaredVariants(text);
  const ref = declared?.[name];
  if (!ref)
    throw new VariantRefusedError(
      `${rel} ne déclare pas de variante « ${name} »`,
    );
  const next = withoutVariant(text, name);
  if (!next)
    throw new VariantRefusedError(
      `${rel}/${SONG_FILE} déclare « variants: » sous une forme que ceci ne sait pas modifier — corrigez-la dans l'éditeur`,
    );
  putFile(`${rel}/${SONG_FILE}`, next);
  removeFile(`${rel}/${ref}`);
}

/** Put one field into a song's master tags. SEEDING never overwrites; FORCING replaces — docs/songs.md. */
async function setSongField(
  folder: string,
  field: "bpm" | "key",
  value: string | number,
  force: boolean,
): Promise<boolean> {
  const rel = folder.replace(/\/+$/, "");
  const name = existingMaster(writablePath(rel));
  if (!name) return false; // no audio: nothing carries the tag, and this does not invent a master
  const abs = writablePath(`${rel}/${name}`);
  const held = (await readMasterTags(abs))[field];
  // The SEEDING rule: a value already there — whatever it is — wins over a fresh detection.
  if (held !== undefined && !force) return false;
  if (held === value) return false;
  try {
    await writeMasterTags(abs, { [field]: value });
  } catch (e) {
    if (e instanceof UntaggableError) return false;
    throw e;
  }
  bump(abs);
  return true;
}

/** Seed a song's detected tempo into its master's tags, never overwriting one already there — see docs/songs.md.
 *
 * `force` is the DESK's door: a detector that halved the tempo has to be correctable, and the
 * seeding rule exists to protect a correction from re-analysis, not from the person correcting it. */
export async function setSongBpm(
  folder: string,
  bpm: number,
  force = false,
): Promise<boolean> {
  if (!(bpm > 0)) return false;
  return setSongField(folder, "bpm", bpm, force);
}

/** …and its KEY, which is a fact about the RECORDING and not about any one set — docs/songs.md.
 *
 * Camelot (`8A`) is deliberately not what is stored: the wheel is a rendering of a key, and keeping
 * the rendering would throw away the mode's name. `C# minor` goes in; `12A` comes out of it. */
export async function setSongKey(
  folder: string,
  key: string,
  force = false,
): Promise<boolean> {
  const clean = key.trim();
  if (!KEY_PATTERN.test(clean)) return false;
  return setSongField(folder, "key", clean, force);
}

/** Rev the family or zone a path belongs to, so the next poll refetches its listing. */
function bump(abs: string): void {
  const path = relative(mediatekDir(), abs).split(sep).join("/");
  const fam = familyOf(path);
  if (fam) bumped(fam);
  // Not a family, but a zone with a surface polling it — see docs/recordings.md.
  else if (path.startsWith(`${RECORDINGS_DIR}/`)) bumped(RECORDINGS_DIR);
}
