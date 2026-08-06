// rank.ts — which answer to a slskd search is worth downloading: the same artist, the best
// format first, and a peer that will actually serve it. Pure and tested, because this is the
// code that decides what ends up in the library. See ../../docs/hunt.md.

import { extOf, isAudio } from "@studio/mediatek/media";

/** One file in a peer's answer. The field names are slskd's, which are Soulseek.NET's. */
export interface SlskdFile {
  /** The peer's own path, with BACKSLASHES: `@user\Music\Nirvana\Nevermind\02 Lithium.mp3`. */
  filename: string;
  size: number;
  bitRate?: number | null;
  /** Seconds. Optional in the protocol, and plenty of clients omit it. */
  length?: number | null;
  isVariableBitRate?: boolean | null;
  /** Shared only with people the peer favours — enqueuing one is a refusal waiting to happen. */
  isLocked?: boolean;
}

/** One peer's answer to a search. */
export interface SlskdResponse {
  username: string;
  hasFreeUploadSlot?: boolean;
  queueLength?: number;
  uploadSpeed?: number;
  files?: SlskdFile[];
}

/** A file we would take, from a peer we could take it from. */
export interface Candidate {
  username: string;
  file: SlskdFile;
  /** The tier: lossless, then 320, then down. `qualityOf`. */
  quality: number;
  /** Kbps — the peer's figure, or the one measured from the bytes. */
  bitrate: number | null;
  hasFreeUploadSlot: boolean;
  queueLength: number;
  uploadSpeed: number;
}

/** What the library itself calls lossless. A subset of `AUDIO_EXT`: `.ape` and `.wv` are all
 *  over Soulseek and the médiathèque cannot file either, so they are not "better", they are out. */
const LOSSLESS_EXT = new Set([".flac", ".wav", ".aiff", ".aif"]);

/** Words that carry no identity. Dropped from BOTH sides, because half of Soulseek files
 *  the Beatles under `Beatles` and the other half under `The Beatles`. */
const NOISE = new Set(["the", "a", "an", "le", "la", "les", "los", "el"]);

/** The last segment of a peer's path, which is the only part that is a file name. */
export function baseNameOf(filename: string): string {
  return filename.split(/[\\/]/).pop() ?? filename;
}

/**
 * A name reduced to what two spellings of it have in common.
 *
 * A Soulseek path is whatever the person sharing it typed — `AC-DC`, `AC_DC`, `ac dc` — while
 * MusicBrainz says `AC/DC`. All of them come down to `ac dc`, and that is the only level at
 * which the two can be compared at all.
 */
export function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The words of a name worth matching on. */
export function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((w) => w.length > 1 && !NOISE.has(w));
}

/**
 * Do these words all appear in that text, as WORDS?
 *
 * Whole words and not substrings: `Air` is an artist, and `includes("air")` would take every
 * file Airbourne ever shared. The cost is that a run-together spelling is missed, which is the
 * cheaper mistake — a hunt that finds nothing says so, a hunt that files the wrong band does not.
 */
function hasAllWords(want: string[], hay: string): boolean {
  const words = new Set(normalise(hay).split(" "));
  return want.every((w) => words.has(w));
}

/**
 * Is this peer's file by the artist we asked for?
 *
 * Tested against the WHOLE path, because the artist is nearly always a parent folder rather
 * than part of the file name.
 */
export function artistMatches(artist: string, filename: string): boolean {
  const want = tokens(artist);
  // An artist made only of noise words — "The The" — leaves nothing to test, and `every` on an
  // empty list is vacuously TRUE, which would accept every file on the network.
  if (!want.length) {
    const bare = normalise(artist);
    return bare.length > 0 && normalise(filename).includes(bare);
  }
  return hasAllWords(want, filename);
}

/**
 * …and is it the song we asked for?
 *
 * The file NAME only. The album folder above it names eleven other songs, and a path-wide test
 * would call every track on Nevermind a match for "Lithium".
 */
export function titleMatches(title: string, filename: string): boolean {
  const base = baseNameOf(filename);
  const stem = base.slice(0, base.length - extOf(base).length);
  const want = tokens(title);
  if (!want.length) {
    const bare = normalise(title);
    return bare.length > 0 && normalise(stem).includes(bare);
  }
  return hasAllWords(want, stem);
}

/**
 * Kbps — the peer's figure, or the one the bytes imply.
 *
 * Measured when absent, because `bitRate` is optional in the protocol and a great many clients
 * leave it out. Size over duration is the number the encoder used, and it is the whole
 * difference between a 320 and a 128 when nobody wrote it down.
 */
export function bitrateOf(f: SlskdFile): number | null {
  if (f.bitRate && f.bitRate > 0) return f.bitRate;
  if (f.length && f.length > 0 && f.size > 0)
    return Math.round((f.size * 8) / f.length / 1000);
  return null;
}

/**
 * The tier the request names: lossless, then mp3 320, then down.
 *
 * FLAC sits above WAV and AIFF though all three are lossless: they hold the same audio, and the
 * one that is half the size and carries its own tags is the one to keep a library in.
 */
export function qualityOf(f: SlskdFile): number {
  const ext = extOf(baseNameOf(f.filename));
  if (ext === ".flac") return 500;
  if (LOSSLESS_EXT.has(ext)) return 450;
  const kbps = bitrateOf(f);
  // Lossy, and the peer said nothing we could measure either. Below every known rate rather
  // than above: an unknown that outranked a measured 320 would win by being uninformative.
  if (kbps === null) return 100;
  if (kbps >= 320) return 300;
  if (kbps >= 256) return 250;
  if (kbps >= 192) return 200;
  return 150;
}

/** Everything about a peer that predicts whether it will actually send the file. */
function availability(c: Candidate): number[] {
  return [c.hasFreeUploadSlot ? 0 : 1, c.queueLength, -c.uploadSpeed];
}

/**
 * The peers worth trying, best first — one entry per peer.
 *
 * ONE per peer, because that is what the request's "change user" step operates on: a peer
 * sharing a whole discography would otherwise fill the first ten places by itself, and ten
 * switches would all land on the same queue that was not moving.
 *
 * Quality decides, as asked. Availability breaks ties INSIDE a tier, and that is not a
 * refinement: a download is abandoned after sixty seconds of not starting, so a peer with a
 * three-hundred-long queue is worth nothing however good its copy is. Two files of the same
 * tier are the same file — the only thing left to choose on is who will actually send it.
 */
export function rankCandidates(
  responses: SlskdResponse[],
  want: { artist: string; title: string },
): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const r of responses) {
    for (const file of r.files ?? []) {
      // The library's OWN gate, not a second list beside it: `masterName` throws on anything
      // else at filing time, so taking it would mean a download that cannot be put away.
      if (!isAudio(baseNameOf(file.filename))) continue;
      if (file.isLocked) continue;
      if (!artistMatches(want.artist, file.filename)) continue;
      if (!titleMatches(want.title, file.filename)) continue;
      const c: Candidate = {
        username: r.username,
        file,
        quality: qualityOf(file),
        bitrate: bitrateOf(file),
        hasFreeUploadSlot: Boolean(r.hasFreeUploadSlot),
        queueLength: r.queueLength ?? 0,
        uploadSpeed: r.uploadSpeed ?? 0,
      };
      const held = best.get(r.username);
      if (!held || c.quality > held.quality) best.set(r.username, c);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.quality !== b.quality) return b.quality - a.quality;
    const [x, y] = [availability(a), availability(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    // Last resort, so the same search twice gives the same order — a list that reshuffled
    // would make a failure impossible to reproduce.
    return a.username.localeCompare(b.username);
  });
}

/** Where a transfer has got to, in the four states this cares about. */
export type TransferPhase = "queued" | "running" | "done" | "failed";

/**
 * Read slskd's transfer state.
 *
 * The wire value is a comma-joined flags enum — `"Completed, Succeeded"`, `"Queued, Remotely"` —
 * so this matches by SUBSTRING and not by equality. That is deliberate: the exact spelling is
 * Soulseek.NET's to change, and a switch over literals would silently classify a renamed flag
 * as "still queued" and wait sixty seconds for nothing.
 */
export function classify(state: string | null | undefined): TransferPhase {
  const s = (state ?? "").toLowerCase();
  if (s.includes("succeeded")) return "done";
  if (
    s.includes("cancelled") ||
    s.includes("canceled") ||
    s.includes("errored") ||
    s.includes("timedout") ||
    s.includes("rejected") ||
    s.includes("aborted")
  )
    return "failed";
  // `Initializing` counts as started: the peer has answered and the two are negotiating, which
  // is exactly what the sixty-second rule is waiting to see.
  if (s.includes("inprogress") || s.includes("initializing")) return "running";
  return "queued";
}
