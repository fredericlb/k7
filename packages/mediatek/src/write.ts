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

/** Which family a path belongs to, or null — the shared folders have no token of their own. */
export function familyOf(rel: string): Family | null {
  const top = rel.split(/[\\/]+/)[0];
  return FAMILIES.includes(top as Family) ? (top as Family) : null;
}

/** Write one file, creating its folder — beside then renamed, because the moteur may be reading. */
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

/** Move or rename ATOMICALLY, a folder as readily as a file, revving BOTH ends — see docs/index.md. */
export function moveEntry(from: string, to: string): void {
  ensureLayout();
  const src = writablePath(from);
  const dst = writablePath(to);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
  bump(src);
  bump(dst);
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
    return readdirSync(abs).find((n) => isAudio(n)) ?? null;
  } catch {
    return null;
  }
}

/** Is this folder ALREADY a song? A sidecar, or failing that any audio — the scan's own test. */
function isSongFolder(abs: string): boolean {
  return existsSync(join(abs, SONG_FILE)) || existingMaster(abs) !== null;
}

/** File one uploaded audio file as a song: the folder, the master, the sidecar — see docs/songs.md. */
export function addSong(opts: {
  filename: string;
  bytes: Uint8Array;
  tags: SongTags;
  /** Replace the master already there. Absent, an occupied folder is a refusal, not a clobber. */
  replace?: boolean;
}): { path: string; master: string; replaced: boolean } {
  const folder = songFolder(opts.tags);
  const name = masterName(opts.filename); // refuses anything the scan won't see as audio
  ensureLayout();
  const already = existingMaster(writablePath(folder));
  if (already && !opts.replace)
    throw new SongExistsError(`${folder} already holds ${already}`);
  putFile(`${folder}/${name}`, opts.bytes);
  // A replacement in another format would otherwise leave two masters for the scan to pick from.
  if (already && already !== name) removeFile(`${folder}/${already}`);
  putFile(`${folder}/${SONG_FILE}`, sidecarFor(opts.tags));
  return {
    path: folder,
    master: `${folder}/${name}`,
    replaced: Boolean(already),
  };
}

/** The `variants:` a sidecar declares; `null` means the key is there and is not a mapping, which this refuses rather than repairs — see docs/variants.md. */
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

/** Add an uploaded file to an existing song as a VARIANT: the bytes beside the master, and the sidecar line that makes them one — see docs/variants.md. */
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

/** Seed a song's detected tempo into its sidecar, never overwriting an existing key — see docs/songs.md. */
export function setSongBpm(folder: string, bpm: number): boolean {
  if (!(bpm > 0)) return false;
  const abs = writablePath(`${folder}/${SONG_FILE}`);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return false; // no sidecar: the folder is not catalogued, and this does not catalogue it
  }
  // A line-level check, not a YAML round trip, which would drop the sidecar's comments.
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
