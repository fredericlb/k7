// migrateSongTags.ts — move every song's title, artist, album, bpm and key out of its song.yaml
// and into its master's tags, once, on a library volume. The sidecar's value wins over a tag the
// file already had, since the sidecar was the truth until now. A song whose master cannot be
// tagged keeps its sidecar untouched, and is listed. See ../docs/songs.md.
//
// Usage:
//   node --experimental-strip-types scripts/migrateSongTags.ts [--root <library>] [--dry-run]
//   (the root defaults to $STUDIO_MEDIATEK)

import { randomUUID } from "node:crypto";
import {
  type Dirent,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { isAudio, withoutDerived } from "../src/media.ts";
import { UntaggableError, writeMasterTags } from "../src/tags.ts";
import { type MasterTags, SONG_FILE } from "../src/types.ts";

/** The fields that move; everything else in a sidecar (source, uuid, variants) stays where it is. */
const MOVED = ["title", "artist", "album", "bpm", "key"] as const;

/** The header the upload used to write, which named fields the sidecar no longer holds. */
const OLD_HEADER = [
  /^# L'arborescence est déduite de ces trois champs/,
  /^# Voir packages\/mediatek\/docs\/songs\.md\.?\s*$/,
];
const NEW_HEADER =
  "# Title, artist, album, tempo and key live in the master's tags — see packages/mediatek/docs/songs.md.";

export type Outcome =
  | { kind: "migrated"; tags: Partial<MasterTags> }
  | { kind: "nothing" }
  | { kind: "no-master" }
  | { kind: "untaggable"; why: string }
  | { kind: "unreadable" };

/** The sidecar's text without the moved keys (and their continuation lines) or the old header — comments otherwise kept. */
export function stripMoved(text: string): string {
  const out: string[] = [];
  let skipping = false;
  let removed = false;
  for (const line of text.split("\n")) {
    if (skipping && /^\s+\S/.test(line)) continue; // a moved key's wrapped value
    skipping = false;
    if (MOVED.some((k) => new RegExp(`^${k}\\s*:`).test(line))) {
      skipping = removed = true;
      continue;
    }
    if (OLD_HEADER.some((re) => re.test(line))) {
      removed = true;
      continue;
    }
    out.push(line);
  }
  if (!removed) return text;
  const body = out.join("\n").replace(/^\n+/, "");
  return body.startsWith(NEW_HEADER) ? body : `${NEW_HEADER}\n${body}`;
}

/** The moved fields a parsed sidecar carries, as the tag writer takes them. */
function movedFields(doc: Record<string, unknown>): Partial<MasterTags> {
  const out: Partial<Record<keyof MasterTags, string | number>> = {};
  for (const k of MOVED) {
    const v = doc[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
    else if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out as Partial<MasterTags>;
}

/** Migrate one song folder; writes nothing when `dry`. */
export async function migrateSongFolder(
  dir: string,
  dry = false,
): Promise<Outcome> {
  let text: string;
  let doc: Record<string, unknown>;
  try {
    text = readFileSync(join(dir, SONG_FILE), "utf8");
    const v = parseYaml(text);
    doc = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return { kind: "unreadable" };
  }
  const tags = movedFields(doc);
  const stripped = stripMoved(text);
  if (Object.keys(tags).length === 0 && stripped === text)
    return { kind: "nothing" };
  const master = withoutDerived(
    readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()),
  ).find((e) => isAudio(e.name));
  if (!master) return { kind: "no-master" };
  if (dry) return { kind: "migrated", tags };
  try {
    if (Object.keys(tags).length)
      await writeMasterTags(join(dir, master.name), tags);
  } catch (e) {
    if (e instanceof UntaggableError)
      return { kind: "untaggable", why: e.message };
    throw e;
  }
  // The tags landed: only now does the sidecar lose its copy, beside then renamed.
  const tmp = join(dir, `${SONG_FILE}.${randomUUID()}.part`);
  writeFileSync(tmp, stripped, "utf8");
  renameSync(tmp, join(dir, SONG_FILE));
  return { kind: "migrated", tags };
}

/** Every folder under `songs/` holding a sidecar — the whole family, the `K7` releases included. */
export function sidecarFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === SONG_FILE)) out.push(abs);
    for (const e of entries)
      if (e.isDirectory() && !e.name.startsWith(".")) walk(join(abs, e.name));
  };
  walk(join(root, "songs"));
  return out.sort();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf("--root");
  const root = at >= 0 ? argv[at + 1] : process.env.STUDIO_MEDIATEK;
  const dry = argv.includes("--dry-run");
  if (!root) {
    console.error("Usage: migrateSongTags.ts --root <library> [--dry-run]");
    process.exit(1);
  }
  const counts: Record<Outcome["kind"], number> = {
    migrated: 0,
    nothing: 0,
    "no-master": 0,
    untaggable: 0,
    unreadable: 0,
  };
  for (const dir of sidecarFolders(root)) {
    const rel = relative(root, dir);
    const r = await migrateSongFolder(dir, dry);
    counts[r.kind]++;
    if (r.kind === "migrated")
      console.log(
        `${dry ? "would tag" : "✓"} ${rel} ${JSON.stringify(r.tags)}`,
      );
    else if (r.kind === "untaggable") console.error(`✗ ${rel}: ${r.why}`);
    else if (r.kind === "no-master")
      console.error(`• ${rel}: no audio, sidecar kept`);
    else if (r.kind === "unreadable")
      console.error(`• ${rel}: unreadable ${SONG_FILE}, kept`);
  }
  console.log(
    `\n${counts.migrated} ${dry ? "to migrate" : "migrated"}, ${counts.nothing} already clean, ` +
      `${counts["no-master"]} without audio, ${counts.untaggable} untaggable, ${counts.unreadable} unreadable.`,
  );
  if (counts.untaggable || counts.unreadable) process.exit(1);
}

// Guarded so a test can import the pieces without this running with the test's own argv.
if (import.meta.url === `file://${process.argv[1]}`) await main();
