// songMaster.ts — audio dropped on a song with NO master: the first file becomes its master, the songbook's
// way (named by the sidecar, tagged on landing, lyrics looked up), and only the rest become variants.
// The one thing a reader would get wrong: a masterless folder with no uuid is adopted first, for an id (../docs/library.md).

import { isAudio } from "@studio/mediatek/media";
import type { MediatekEntry } from "@studio/mediatek/types";
import { library } from "./api";

/** Which dropped file lands as the master — the first audio one, and only on a song that has none. */
export function splitDrop(
  entry: MediatekEntry | null,
  files: File[],
): { master: File | null; variants: File[] } {
  if (!entry || entry.meta?.master) return { master: null, variants: files };
  const i = files.findIndex((f) => isAudio(f.name));
  if (i < 0) return { master: null, variants: files };
  return { master: files[i], variants: files.filter((_, j) => j !== i) };
}

/** The songbook id to file a master under: the sidecar's uuid, or one the adoption writes. */
async function songbookId(entry: MediatekEntry): Promise<string> {
  const uuid = entry.meta?.uuid;
  if (typeof uuid === "string" && uuid) return uuid;
  const artist = entry.meta?.artist;
  const adopted = await library.adoptSongbook({
    folder: entry.path,
    artist: typeof artist === "string" ? artist : "",
    title: entry.name,
  });
  return adopted.id;
}

/** File one audio file as the song's master; answers the master's library path, for its analysis. */
export async function fileAsMaster(
  entry: MediatekEntry,
  file: File,
): Promise<string | null> {
  const song = await library.setSongbookMaster(await songbookId(entry), file);
  return song.master;
}
