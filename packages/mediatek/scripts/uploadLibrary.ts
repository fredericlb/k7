// uploadLibrary.ts — push a local <artist>/<album>/<title>/<master> tree into a HOSTED pl8,
// one song per leaf folder holding an audio file. The master's own tags win over the folder's
// names, an older tree's song.yaml filling a field the file lacks. Only the
// master travels — no stems, no variants, which the remote client has no route for yet.
//
// Usage:
//   node --experimental-strip-types scripts/uploadLibrary.ts \
//     --root /path/to/library --url https://play.example.com --token <bearer token> \
//     [--replace] [--source <name>]

import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isAudio } from "@studio/mediatek/media";
import { pushSong } from "@studio/mediatek/remote";
import { readMasterTags } from "@studio/mediatek/tags";
import { SONG_FILE } from "@studio/mediatek/types";
import { parse as parseYaml } from "yaml";

interface Args {
  root: string;
  url: string;
  token?: string;
  replace: boolean;
  source?: string;
}

function parseArgs(argv: string[]): Args {
  const out: Partial<Args> = { replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") out.root = argv[++i];
    else if (a === "--url") out.url = argv[++i];
    else if (a === "--token") out.token = argv[++i];
    else if (a === "--source") out.source = argv[++i];
    else if (a === "--replace") out.replace = true;
  }
  if (!out.root || !out.url) {
    console.error(
      "Usage: uploadLibrary.ts --root <path> --url <pl8 base url> --token <token> [--replace] [--source <name>]",
    );
    process.exit(1);
  }
  return out as Args;
}

export interface FoundSong {
  master: string;
  artist: string;
  album: string;
  title: string;
}

function subdirs(abs: string): { name: string }[] {
  try {
    return readdirSync(abs, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
  } catch {
    return [];
  }
}

/** A sidecar written before the tags moved into the master: its fields, or `{}`. */
function legacySidecar(dir: string): Record<string, unknown> {
  try {
    const v = parseYaml(readFileSync(join(dir, SONG_FILE), "utf8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {}; // no sidecar, or an unreadable one
  }
}

/** Each field from the master's tags, else an older tree's sidecar, else the folder's own name. */
async function tagsOf(
  dir: string,
  master: string,
  fallback: { artist: string; album: string; title: string },
): Promise<{ artist: string; album: string; title: string }> {
  const tags = await readMasterTags(master);
  const sidecar = legacySidecar(dir);
  const pick = (k: "artist" | "album" | "title"): string => {
    const old = sidecar[k];
    return tags[k] || (typeof old === "string" && old ? old : fallback[k]);
  };
  return { artist: pick("artist"), album: pick("album"), title: pick("title") };
}

/** Every leaf folder three levels under root holding an audio file — the first one is the master. */
export async function findSongs(root: string): Promise<FoundSong[]> {
  const out: FoundSong[] = [];
  for (const artistDir of subdirs(root)) {
    const artistPath = join(root, artistDir.name);
    for (const albumDir of subdirs(artistPath)) {
      const albumPath = join(artistPath, albumDir.name);
      for (const titleDir of subdirs(albumPath)) {
        const titlePath = join(albumPath, titleDir.name);
        const files = readdirSync(titlePath, { withFileTypes: true }).filter(
          (e) => e.isFile(),
        );
        const master = files.find((f) => isAudio(f.name));
        if (!master) continue;
        const abs = join(titlePath, master.name);
        const tags = await tagsOf(titlePath, abs, {
          artist: artistDir.name,
          album: albumDir.name,
          title: titleDir.name,
        });
        out.push({ master: abs, ...tags });
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!statSync(args.root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`${args.root} is not a directory.`);
    process.exit(1);
  }

  const songs = await findSongs(args.root);
  if (!songs.length) {
    console.log(
      `No songs found under ${args.root} (expected <artist>/<album>/<title>/<master file>).`,
    );
    return;
  }
  console.log(`Found ${songs.length} song(s). Uploading to ${args.url}…`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const song of songs) {
    const label = `${song.artist} / ${song.album} / ${song.title}`;
    try {
      const bytes = readFileSync(song.master);
      const r = await pushSong(
        { base: args.url, token: args.token },
        {
          filename: basename(song.master),
          bytes,
          artist: song.artist,
          album: song.album,
          title: song.title,
          source: args.source,
          replace: args.replace,
        },
      );
      console.log(`${r.replaced ? "↻" : "✓"} ${label}`);
      uploaded++;
    } catch (e) {
      const message = (e as Error).message;
      // The route's own refusal for an occupied folder, not asked to replace it.
      if (message.includes(" 409 ")) {
        console.log(
          `• ${label} — already there, skipped (--replace to overwrite)`,
        );
        skipped++;
      } else {
        console.error(`✗ ${label}: ${message}`);
        failed++;
      }
    }
  }

  console.log(`\n${uploaded} uploaded, ${skipped} skipped, ${failed} failed.`);
  if (failed) process.exit(1);
}

// Guarded so a test can import findSongs without this running with the test's own argv.
if (import.meta.url === `file://${process.argv[1]}`) main();
