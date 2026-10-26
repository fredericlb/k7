// migrateSongbook.ts — move every songbook song out of the rehearsal store (k7.db, sheets/) and into
// the library: its lyrics, tablature and sheets into a song folder, its bookkeeping into the sidecar
// (packages/mediatek/docs/songbook.md). A song with a library track joins that track's folder; one
// without lands where an upload of its names would. Idempotent, by the song's id: run it again to finish one.
//
// Usage (tsx, so the workspace's TypeScript loads as the server loads it):
//   npx tsx scripts/migrateSongbook.ts [--data <K7_DATA_DIR>] [--library <STUDIO_MEDIATEK>] [--dry-run]

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { formatTimecode } from "@studio/lyrics/chords";
import { hasTimecodes, timingsByLine } from "@studio/lyrics/lrc";

/** One `Songs` record of the store, as its JSON fields hold it. */
export type SongFields = Record<string, unknown>;

/** What happened to one song. */
export interface Outcome {
  uid: string;
  folder: string;
  kind: "migrated" | "would-migrate" | "skipped";
  notes: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The store's songs and the folder their sheets' bytes live in, read without writing a byte. */
export function readStore(dataDir: string): {
  songs: SongFields[];
  sheetsDir: string;
} {
  const db = new DatabaseSync(join(dataDir, "k7.db"), { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT fields FROM records WHERE coll = 'Songs'")
      .all() as { fields: string }[];
    return {
      songs: rows.map((r) => JSON.parse(r.fields) as SongFields),
      sheetsDir: join(dataDir, "sheets"),
    };
  } finally {
    db.close();
  }
}

/** Timings stored BESIDE the text, laid into it as `{{MM:SS}}` — the songbook reads only the inline form now. */
export function foldTimings(lyrics: string, timingsJson: unknown): string {
  let timings: { line: number; text: string; t: number }[] = [];
  try {
    const parsed = JSON.parse(str(timingsJson) || "[]");
    if (Array.isArray(parsed)) timings = parsed;
  } catch {
    return lyrics;
  }
  if (!timings.length || !lyrics.trim() || hasTimecodes(lyrics)) return lyrics;
  const lines = lyrics.split("\n");
  for (const [i, t] of timingsByLine(lyrics, timings))
    lines[i] = lines[i].replace(
      /^\s*/,
      (indent) => `${indent}${formatTimecode(t)} `,
    );
  return lines.join("\n");
}

/** The sheets a record lists, in order. */
function sheetsOf(f: SongFields): {
  id: string;
  attachmentId: string;
  name: string;
  mime: string;
}[] {
  try {
    const v = JSON.parse(str(f.SheetMeta) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Migrate every song; the library is the one $STUDIO_MEDIATEK names, set before this is called. */
export async function migrate(opts: {
  dataDir: string;
  dry: boolean;
  log?: (o: Outcome) => void;
}): Promise<Outcome[]> {
  // Loaded here, not at the top: the library's root is read from the environment the caller set.
  const book = await import("@studio/mediatek/songbook");
  const { listFamilyFresh, flushIndex } = await import(
    "@studio/mediatek/catalogue"
  );
  const { ensureLayout, safePath } = await import("@studio/mediatek/layout");
  const { songFolder } = await import("@studio/mediatek/song");
  ensureLayout();
  const { songs, sheetsDir } = readStore(opts.dataDir);
  // One listing for the whole run: which folder already carries which id.
  const folderOf = new Map<string, string>();
  const idAt = new Map<string, string>();
  for (const e of (await listFamilyFresh("songs")).entries) {
    const id = e.meta?.uuid;
    if (typeof id !== "string" || !id) continue;
    folderOf.set(id, e.path);
    idAt.set(e.path, id);
  }
  const out: Outcome[] = [];
  for (const f of songs) {
    const uid = str(f.Uid);
    const notes: string[] = [];
    if (!uid) continue;
    const artist = str(f.Artist) || "Artiste inconnu";
    const title = str(f.Title) || "Sans titre";
    let folder = folderOf.get(uid) ?? "";
    if (!folder) {
      // A track already in the library: the song joins that folder, unless another song holds it.
      const audio = str(f.AudioPath);
      const own = audio.startsWith("songs/")
        ? audio.split("/").slice(0, -1).join("/")
        : "";
      if (own && existsSync(safePath(audio)) && !idAt.has(own)) folder = own;
      else if (own)
        notes.push(`its track ${audio} is gone or another song's: filed apart`);
    }
    if (f.Private) notes.push("was private, public now");
    if (opts.dry) {
      const o: Outcome = {
        uid,
        folder: folder || songFolder({ artist, title }),
        kind: "would-migrate",
        notes,
      };
      out.push(o);
      opts.log?.(o);
      continue;
    }
    if (!folderOf.has(uid)) {
      const made = book.createSongbook({
        id: uid,
        artist,
        title,
        owner: str(f.OwnerId),
        createdAt: str(f.CreatedAt),
        ...(folder ? { folder } : {}),
      });
      folder = made.path;
      folderOf.set(uid, folder);
      idAt.set(folder, uid);
    }
    book.writeTextsAt(folder, {
      lyrics: foldTimings(str(f.Lyrics), f.LyricTimings),
      tablature: str(f.Tablature),
    });
    const instrumental = str(f.InstrumentalPath);
    book.setFactsAt(folder, {
      lyricsMatch: str(f.LyricsMatch),
      fetchIgnored: f.FetchIgnored === true,
      origin: str(f.Origin),
      instrumental: instrumental.startsWith("songs/") ? instrumental : "",
    });
    // A sheet already carried over keeps its id, so a second run adds only what is missing.
    const done = new Set(
      (await book.readSongbookAt(folder)).facts.sheets.map((s) => s.id),
    );
    for (const s of sheetsOf(f)) {
      if (done.has(s.id)) continue;
      const bytesAt = join(sheetsDir, s.attachmentId);
      if (!existsSync(bytesAt)) {
        notes.push(`sheet ${s.name}: no bytes in the store`);
        continue;
      }
      await book.addSheetAt(folder, {
        bytes: readFileSync(bytesAt),
        name: s.name,
        mime: s.mime,
        id: s.id,
      });
    }
    const o: Outcome = { uid, folder, kind: "migrated", notes };
    out.push(o);
    opts.log?.(o);
  }
  await flushIndex();
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const at = argv.indexOf(name);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const dataDir =
    arg("--data") ||
    process.env.K7_DATA_DIR ||
    join(homedir(), ".studio", "k7");
  const library = arg("--library") || process.env.STUDIO_MEDIATEK;
  if (!library) {
    console.error(
      "Usage: migrateSongbook.ts [--data <K7_DATA_DIR>] --library <STUDIO_MEDIATEK> [--dry-run]",
    );
    process.exit(1);
  }
  process.env.STUDIO_MEDIATEK = library;
  const dry = argv.includes("--dry-run");
  const outcomes = await migrate({
    dataDir,
    dry,
    log: (o) =>
      console.log(
        `${o.kind === "migrated" ? "✓" : "→"} ${o.uid} ${o.folder}${o.notes.length ? ` (${o.notes.join("; ")})` : ""}`,
      ),
  });
  console.log(
    `\n${outcomes.length} song(s) ${dry ? "to migrate" : "migrated"}; the store's rows are left as they were.`,
  );
}

// Guarded so a test can import the pieces without this running with the test's own argv.
if (import.meta.url === `file://${process.argv[1]}`) await main();
