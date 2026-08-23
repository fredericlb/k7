// hunt.ts — one search, end to end: MusicBrainz names the song, slskd finds who has it, the
// best peer that will actually send it does, SFTP brings the bytes back and `addSong` files
// them. Runs in the background and writes its progress to the store. See ../../docs/hunt.md.

import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { writablePath } from "@studio/mediatek/layout";
import { extOf } from "@studio/mediatek/media";
import { MASTER_STEM, type SongTags, songFolder } from "@studio/mediatek/song";
import { addSong } from "@studio/mediatek/write";
import { lookup } from "./musicbrainz.ts";
import {
  baseNameOf,
  type Candidate,
  classify,
  rankCandidates,
} from "./rank.ts";
import { baseName, fetchDownload } from "./sftp.ts";
import {
  cancelDownload,
  downloadsOf,
  enqueue,
  releaseSearch,
  searchDone,
  searchResponses,
  startSearch,
} from "./slskd.ts";
import { type HuntRecord, listHunts, patchHunt, saveHunt } from "./store.ts";
import { fetchFromYoutube, youtubeQuery } from "./youtube.ts";

/** Soulseek was asked and exhausted — a CLASS, not a re-read message; see ../../docs/hunt.md. */
class ExhaustedError extends Error {}

/** A peer gets this long to START sending before the hunt moves to the next one. */
export const NO_START_MS = 60_000;

/** …and this many moves before the hunt is a failure — ten peers tried, ../../docs/hunt.md. */
export const MAX_SWITCHES = 10;

/** How long the network gets to answer a search before what arrived is ranked. */
const SEARCH_WINDOW_MS = 12_000;

/** Once a transfer IS moving, how long it may take — a peer that sends two kilobytes and sulks. */
const TRANSFER_CAP_MS = 30 * 60_000;

const POLL_MS = 2_000;

/** The hunts this process is running, so a restart can tell its rows from a live one. */
const running = new Map<string, AbortController>();

export const runningIds = (): Set<string> => new Set(running.keys());

const message = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("recherche annulée"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("recherche annulée"));
      },
      { once: true },
    );
  });
}

/** Already filed? Asked BEFORE downloading — learning it after forty megabytes is worse. */
function alreadyFiled(tags: SongTags): string | null {
  const folder = songFolder(tags);
  try {
    const hit = readdirSync(writablePath(folder)).find((f) =>
      f.startsWith(`${MASTER_STEM}.`),
    );
    return hit ? `${folder}/${hit}` : null;
  } catch {
    return null;
  }
}

// `addToPlaylist` was here: a hunt files the song and st0 adds it to a set list — ../../docs/hunt.md.

/** Everything the network answered, up to the window or until it says it is done. */
async function gather(searchId: string, signal: AbortSignal) {
  const until = Date.now() + SEARCH_WINDOW_MS;
  let last = await searchResponses(searchId);
  while (Date.now() < until) {
    await sleep(1_500, signal);
    last = await searchResponses(searchId);
    if (await searchDone(searchId)) break;
  }
  return last;
}

type Outcome = "done" | "stalled" | "failed";

/** Wait on one peer: `stalled` is the sixty-second rule, `failed` is a refusal that never waits. */
async function watch(
  c: Candidate,
  signal: AbortSignal,
): Promise<{ outcome: Outcome; transferId: string }> {
  const startBy = Date.now() + NO_START_MS;
  const cap = Date.now() + TRANSFER_CAP_MS;
  let started = false;
  let seen = false;
  let transferId = "";
  while (Date.now() < cap) {
    await sleep(POLL_MS, signal);
    const all = await downloadsOf(c.username);
    const t =
      all.find((x) => x.filename === c.file.filename) ??
      all.find((x) => baseName(x.filename) === baseName(c.file.filename));
    if (t) {
      seen = true;
      transferId = t.id || transferId;
    } else if (seen) {
      // There and now gone: slskd drops a transfer it has given up on, which is an answer.
      return { outcome: "failed", transferId };
    }
    const phase = classify(t?.state);
    if (phase === "done") return { outcome: "done", transferId };
    if (phase === "failed") return { outcome: "failed", transferId };
    if (phase === "running") started = true;
    if (!started && Date.now() >= startBy)
      return { outcome: "stalled", transferId };
  }
  return { outcome: "stalled", transferId };
}

/** Album then title, then the title alone — never the artist, which filters instead: ../../docs/hunt.md. */
export function searchTexts(
  album: string | null | undefined,
  title: string,
): string[] {
  const t = title.trim();
  if (!t) return [];
  const a = (album ?? "").trim();
  // No album leaves a single attempt rather than the same search run twice.
  return a ? [`${a} ${t}`, t] : [t];
}

/** Work down the ranked peers; `tried` is the budget across BOTH searches — ../../docs/hunt.md. */
async function takeFromSomeone(
  sub: string,
  id: string,
  candidates: Candidate[],
  tried: Set<string>,
  signal: AbortSignal,
): Promise<Candidate | null> {
  for (const c of candidates) {
    if (tried.size >= MAX_SWITCHES) return null;
    if (tried.has(c.username)) continue;
    tried.add(c.username);
    patchHunt(sub, id, {
      status: "downloading",
      peer: c.username,
      switches: tried.size - 1,
      format: extOf(baseNameOf(c.file.filename)),
      bitrate: c.bitrate,
    });
    await enqueue(c.username, {
      filename: c.file.filename,
      size: c.file.size,
    });
    const { outcome, transferId } = await watch(c, signal);
    if (outcome === "done") return c;
    if (transferId) await cancelDownload(c.username, transferId);
  }
  return null;
}

async function run(
  sub: string,
  id: string,
  query: string,
  signal: AbortSignal,
): Promise<void> {
  const tags = await lookup(query);
  // Null and not a guess: filing a typo as an artist makes a folder nobody finds again.
  if (!tags) throw new Error("aucun morceau ne correspond à ce nom");
  const songTags: SongTags = {
    artist: tags.artist,
    title: tags.title,
    album: tags.album ?? undefined,
    // Where it came from, for whoever reads the folder — beside `upload` and `k7`.
    source: "slskd",
  };
  patchHunt(sub, id, {
    artist: tags.artist,
    title: tags.title,
    album: tags.album ?? undefined,
    date: tags.date ?? undefined,
  });

  const already = alreadyFiled(songTags);
  if (already) {
    patchHunt(sub, id, {
      status: "done",
      path: already,
      error: "déjà dans la médiathèque",
      endedAt: Date.now(),
    });
    return;
  }

  // Album then title, then the title alone — never the artist. See `searchTexts`.
  const tried = new Set<string>();
  let taken: Candidate | null = null;
  let why = "";
  // Set here and nowhere else: only what happens INSIDE this loop speaks to availability.
  let exhausted = false;
  for (const text of searchTexts(tags.album, tags.title)) {
    if (tried.size >= MAX_SWITCHES) break;
    const searchId = await startSearch(text);
    try {
      const responses = await gather(searchId, signal);
      const candidates = rankCandidates(responses, {
        artist: tags.artist,
        title: tags.title,
      });
      if (!candidates.length) {
        why = `personne ne partage « ${text} » dans un format utilisable`;
        exhausted = true;
        continue;
      }
      taken = await takeFromSomeone(sub, id, candidates, tried, signal);
      if (taken) break;
      // Peers existed and none sent: the clearest form of exhaustion there is.
      exhausted = true;
      why = `${tried.size} pair${tried.size > 1 ? "s" : ""} essayé${tried.size > 1 ? "s" : ""} pour « ${text} », aucun n'a commencé à envoyer`;
    } finally {
      // NOT awaited: it is slskd's housekeeping, not this hunt's outcome — ../../docs/hunt.md.
      void releaseSearch(searchId);
    }
  }
  // The LAST reason, from the narrowest search still standing, is the only one worth showing.
  if (!taken) {
    const why2 = why || "aucune recherche n'a abouti";
    // The TYPE carries the information, not the text: `startHunt` reads it to decide the button.
    throw exhausted ? new ExhaustedError(why2) : new Error(why2);
  }

  const { bytes } = await fetchDownload(taken.file.filename);
  const filed = addSong({
    // The peer's own file name, which gives the master its extension and nothing else.
    filename: baseNameOf(taken.file.filename),
    bytes,
    tags: songTags,
  });
  patchHunt(sub, id, {
    status: "done",
    path: filed.path,
    endedAt: Date.now(),
  });
}

/** Begin, and answer at once with the row the screen will draw. The work carries on behind. */
export function startHunt(sub: string, query: string): HuntRecord {
  const rec: HuntRecord = {
    id: randomUUID(),
    query: query.trim(),
    status: "searching",
    switches: 0,
    startedAt: Date.now(),
  };
  saveHunt(sub, rec);
  const ctl = new AbortController();
  running.set(rec.id, ctl);
  void run(sub, rec.id, rec.query, ctl.signal)
    .catch((e) => {
      patchHunt(sub, rec.id, {
        status: "failed",
        error: message(e),
        // Only that failure says anything about availability, so only it offers the YouTube button.
        exhausted: e instanceof ExhaustedError,
        endedAt: Date.now(),
      });
    })
    .finally(() => {
      running.delete(rec.id);
    });
  return rec;
}

/** The fallback, on the SAME row rather than a new one — `null` if unknown or running already. */
export function startYoutube(sub: string, id: string): HuntRecord | null {
  const row = listHunts(sub).find((h) => h.id === id);
  if (!row || running.has(id)) return null;
  const rec = patchHunt(sub, id, {
    status: "downloading",
    via: "youtube",
    peer: undefined,
    error: undefined,
    endedAt: undefined,
    format: undefined,
    bitrate: undefined,
  });
  if (!rec) return null;
  const ctl = new AbortController();
  running.set(id, ctl);
  void runYoutube(sub, rec)
    .catch((e) => {
      patchHunt(sub, id, {
        status: "failed",
        error: message(e),
        endedAt: Date.now(),
      });
    })
    .finally(() => {
      running.delete(id);
    });
  return rec;
}

async function runYoutube(sub: string, rec: HuntRecord): Promise<void> {
  const query = youtubeQuery(rec);
  const { bytes, filename } = await fetchFromYoutube(query, rec.id);
  const filed = addSong({
    filename,
    bytes,
    tags: {
      artist: rec.artist,
      title: rec.title || rec.query,
      album: rec.album,
      // Once filed, the only trace that this is a video's audio track and not a record.
      source: "youtube",
    },
    // Recovering a failure: nothing is there to overwrite, and if something is, `addSong` refuses.
  });
  patchHunt(sub, rec.id, {
    status: "done",
    path: filed.path,
    format: extOf(filename),
    endedAt: Date.now(),
  });
}

/** Give up on one. The runner's own catch writes the row. */
export function stopHunt(id: string): boolean {
  const ctl = running.get(id);
  if (!ctl) return false;
  ctl.abort();
  return true;
}
