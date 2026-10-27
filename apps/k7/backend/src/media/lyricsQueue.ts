// lyricsQueue.ts — a song's lyrics looked up on LRCLIB when it lands in the library and when it is
// played without any: one lookup at a time, a miss holding the next back a week — the rules are
// @studio/mediatek's autoLyrics.ts, this is the asking. See ../../docs/media/lyrics.md.

import { timeLyrics } from "@studio/lyrics/lrc";
import {
  type LyricsQuery,
  lyricsQuery,
  recordFoundLyrics,
  recordLyricsMiss,
} from "@studio/mediatek/autoLyrics";
import {
  type LyricsFound,
  lookupLyrics,
} from "@studio/rehearsal-server/lrclib";

/** What a lookup asks the outside world; injected, so a test never reaches LRCLIB. */
export type LyricsLookup = (
  artist: string,
  title: string,
  duration?: number,
) => Promise<LyricsFound>;

/** A play sends many requests for one song (Range, seeks): a folder looked at this recently is not looked at again. */
const RECHECK_MS = 10 * 60 * 1000;

/** The pause between two lookups — LRCLIB is a free service, and a library upload is many songs at once. */
const SPACING_MS = 1000;

/** One queue: `want` a folder, and it is looked up when its turn comes, if it is still due. */
export function createLyricsQueue(
  lookup: LyricsLookup | null,
  opts: { spacingMs?: number; now?: () => number } = {},
) {
  const now = opts.now ?? Date.now;
  const spacing = opts.spacingMs ?? SPACING_MS;
  const waiting: string[] = [];
  const queued = new Set<string>();
  const seen = new Map<string, number>();
  let running: Promise<void> | null = null;
  // One lookup at a time, whoever asked: the queue's and a page's take the same turn.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const mine = tail.then(fn);
    tail = mine.catch(() => {});
    return mine;
  };

  async function one(q: LyricsQuery): Promise<void> {
    if (!lookup) return;
    // Nothing asked, so nothing to hold back: a master tagged later is looked up at its next play.
    if (!q.title) return;
    let found: LyricsFound;
    try {
      found = await lookup(q.artist, q.title, q.duration);
    } catch {
      return recordLyricsMiss(q.folder, "error", now());
    }
    if (!found) return recordLyricsMiss(q.folder, "not-found", now());
    if (found.kind === "instrumental")
      return recordLyricsMiss(q.folder, "instrumental", now());
    if (found.kind === "plain")
      return recordFoundLyrics(q, { lyrics: found.text, timed: false });
    const timed = timeLyrics("", found.text);
    if (!timed.ok) return recordLyricsMiss(q.folder, "not-found", now());
    recordFoundLyrics(q, { lyrics: timed.lyrics, timed: true });
  }

  async function drain(): Promise<void> {
    while (waiting.length) {
      const folder = waiting.shift() as string;
      try {
        const q = await lyricsQuery(folder, now());
        if (q) {
          await serial(() => one(q));
          if (waiting.length && spacing)
            await new Promise((ok) => setTimeout(ok, spacing));
        }
      } catch {
        // A folder gone or unreadable meanwhile: the next one is still worth looking up.
      } finally {
        queued.delete(folder);
      }
    }
    running = null;
  }

  return {
    /** Ask for a folder's lyrics; a no-op when it is waiting, was looked at moments ago, or turns out not due. */
    want(folder: string): void {
      if (!lookup || !folder || queued.has(folder)) return;
      const last = seen.get(folder);
      if (last !== undefined && now() - last < RECHECK_MS) return;
      seen.set(folder, now());
      queued.add(folder);
      waiting.push(folder);
      running ??= drain();
    },
    /** Look a folder up NOW, for a person on its page: an earlier miss and a recent look hold nothing back. */
    async lookupNow(folder: string): Promise<void> {
      if (!lookup || !folder) return;
      seen.set(folder, now());
      const q = await lyricsQuery(folder, now(), { asked: true });
      if (q) await serial(() => one(q));
    },
    /** Resolves once every folder asked for so far has had its turn — for a test. */
    idle(): Promise<void> {
      return running ?? Promise.resolve();
    },
  };
}

/** Off in a test run, and wherever $STUDIO_LYRICS_LOOKUP says `off`: a library offline asks nobody. */
const enabled =
  process.env.STUDIO_LYRICS_LOOKUP !== "off" && !process.env.VITEST;

/** The process's one queue, asking LRCLIB. */
export const lyricsQueue = createLyricsQueue(enabled ? lookupLyrics : null);

/** A library path that is a song's audio, as its folder — what a play asks lyrics for. */
export function songFolderOfAudio(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "songs" || parts.length < 3) return null;
  return parts.slice(0, -1).join("/");
}
