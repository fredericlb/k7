// rank.ts — which answer to a slskd search is worth downloading: the same artist, the best
// format first, never a live or bootleg copy, and a peer that will actually serve it. Pure and
// tested, because this is the code that decides what ends up in the library. See ../../../docs/media/hunt.md.

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

/** Lossless as the LIBRARY means it — a subset of `AUDIO_EXT`, so `.ape` and `.wv` are out. */
const LOSSLESS_EXT = new Set([".flac", ".wav", ".aiff", ".aif"]);

/** Words carrying no identity, dropped from BOTH sides — `Beatles` and `The Beatles` are one. */
const NOISE = new Set(["the", "a", "an", "le", "la", "les", "los", "el"]);

/** The last segment of a peer's path, which is the only part that is a file name. */
export function baseNameOf(filename: string): string {
  return filename.split(/[\\/]/).pop() ?? filename;
}

/** A name reduced to what two spellings share: `AC/DC`, `AC-DC` and `ac dc` all become `ac dc`. */
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

/** Do these words all appear in that text, as WORDS? `includes("air")` would take Airbourne. */
function hasAllWords(want: string[], hay: string): boolean {
  const words = new Set(normalise(hay).split(" "));
  return want.every((w) => words.has(w));
}

/** By the artist we asked for? Tested on the WHOLE path — the artist is a parent folder. */
export function artistMatches(artist: string, filename: string): boolean {
  const want = tokens(artist);
  // "The The" leaves nothing to test, and `every` on an empty list accepts the whole network.
  if (!want.length) {
    const bare = normalise(artist);
    return bare.length > 0 && normalise(filename).includes(bare);
  }
  return hasAllWords(want, filename);
}

/** …and the song we asked for? The file NAME only — the album folder names eleven other songs. */
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

/** "live" or "bootleg" as a WORD anywhere in the path — excluded, not scored: ../../../docs/media/hunt.md. */
export function isLiveOrBootleg(filename: string): boolean {
  return /\b(live|bootleg)\b/i.test(filename.replace(/[\\/]/g, " "));
}

/** Kbps — the peer's figure, or size over duration when the optional field is left out. */
export function bitrateOf(f: SlskdFile): number | null {
  if (f.bitRate && f.bitRate > 0) return f.bitRate;
  if (f.length && f.length > 0 && f.size > 0)
    return Math.round((f.size * 8) / f.length / 1000);
  return null;
}

/** The tier: lossless, then 320, then down — FLAC over WAV, same audio at half the size. */
export function qualityOf(f: SlskdFile): number {
  const ext = extOf(baseNameOf(f.filename));
  if (ext === ".flac") return 500;
  if (LOSSLESS_EXT.has(ext)) return 450;
  const kbps = bitrateOf(f);
  // Under every known rate: an unknown that outranked a measured 320 would win by being mute.
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

/** The peers worth trying, best first, ONE entry per peer — the ranking is ../../../docs/media/hunt.md. */
export function rankCandidates(
  responses: SlskdResponse[],
  want: { artist: string; title: string },
): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const r of responses) {
    for (const file of r.files ?? []) {
      // The library's OWN gate: anything else is a download that cannot then be put away.
      if (!isAudio(baseNameOf(file.filename))) continue;
      if (file.isLocked) continue;
      if (!artistMatches(want.artist, file.filename)) continue;
      if (!titleMatches(want.title, file.filename)) continue;
      if (isLiveOrBootleg(file.filename)) continue;
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
    // Last resort, so the same search twice gives an order a failure can be reproduced from.
    return a.username.localeCompare(b.username);
  });
}

/** Where a transfer has got to, in the four states this cares about. */
export type TransferPhase = "queued" | "running" | "done" | "failed";

/** Read slskd's transfer state — a comma-joined flags enum, so by SUBSTRING; ../../../docs/media/hunt.md. */
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
  // `Initializing` counts as started: the peer answered, which is what the minute waits for.
  if (s.includes("inprogress") || s.includes("initializing")) return "running";
  return "queued";
}
