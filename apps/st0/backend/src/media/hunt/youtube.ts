// youtube.ts — the fallback when nobody on Soulseek sent the track: yt-dlp takes YouTube's first
// answer. Runs IN this container, which already holds the volume, so there is no transfer —
// unlike slskd. See ../../../docs/media/hunt.md.

import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isAudio } from "@studio/mediatek/media";
import { huntsDir } from "./store.ts";

/** The médiathèque's upload ceiling. Given to yt-dlp, which gives up before downloading. */
const MAX_MB = 512;

/** A video is not a film: past this, yt-dlp is stuck on something else. */
const TIMEOUT_MS = 5 * 60_000;

const bin = (): string => process.env.YTDLP_BIN || "yt-dlp";

/** The artist IS wanted here, unlike on Soulseek: a video title reads "Artist - Title". */
export function youtubeQuery(tags: {
  artist?: string;
  title?: string;
  query: string;
}): string {
  const named = [tags.artist, tags.title].filter(Boolean).join(" ").trim();
  // The typed text when MusicBrainz recognised nothing: YouTube is far more forgiving of spelling.
  return named || tags.query.trim();
}

/** An ARRAY and never a command line, and `best` keeps the codec — see ../../../docs/media/hunt.md. */
export function ytdlpArgs(query: string, outDir: string): string[] {
  return [
    // `ytsearch1:` turns a phrase into one video; the second is already a cover or a live take.
    `ytsearch1:${query}`,
    "--no-playlist",
    "--extract-audio",
    "--audio-format",
    "best",
    "--audio-quality",
    "0",
    "--max-filesize",
    `${MAX_MB}M`,
    "--socket-timeout",
    "30",
    "--no-progress",
    "--no-warnings",
    "--output",
    join(outDir, "%(id)s.%(ext)s"),
  ];
}

/** The one audio file in the folder: yt-dlp names by video id, so only the codec gives the extension. */
export function audioIn(dir: string): string | null {
  try {
    return readdirSync(dir).find((f) => isAudio(f)) ?? null;
  } catch {
    return null;
  }
}

let probed: boolean | null = null;

/** Is yt-dlp there? Probed once: it is a binary in the image and does not appear mid-run. */
export async function youtubeAvailable(): Promise<boolean> {
  if (probed !== null) return probed;
  probed = await new Promise<boolean>((resolve) => {
    execFile(bin(), ["--version"], { timeout: 10_000 }, (err) => resolve(!err));
  });
  return probed;
}

/** Fetch the track. The work folder is `.hunts/tmp/<id>`, removed whatever happens. */
export async function fetchFromYoutube(
  query: string,
  id: string,
): Promise<{ bytes: Buffer; filename: string }> {
  const dir = join(huntsDir(), "tmp", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        bin(),
        ytdlpArgs(query, dir),
        { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
        (err, _out, stderr) => {
          if (!err) return resolve();
          // ENOENT is worth naming: "not installed" and "the video resisted" ask for two things.
          if ((err as NodeJS.ErrnoException).code === "ENOENT")
            return reject(
              new Error(`yt-dlp n'est pas installé sur ce serveur (${bin()})`),
            );
          const last = String(stderr || err.message)
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop();
          reject(new Error(`yt-dlp : ${last ?? err.message}`.slice(0, 300)));
        },
      );
    });
    const name = audioIn(dir);
    // No audio despite a clean exit: yt-dlp returned a container `masterName` would refuse.
    if (!name)
      throw new Error(
        "yt-dlp n'a produit aucun format audio que la médiathèque accepte",
      );
    return { bytes: readFileSync(join(dir, name)), filename: name };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
