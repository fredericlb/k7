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
  deleteSearch,
  downloadsOf,
  enqueue,
  searchDone,
  searchResponses,
  startSearch,
} from "./slskd.ts";
import { type HuntRecord, patchHunt, saveHunt } from "./store.ts";

/** A peer gets this long to START sending before the hunt moves to the next one. */
export const NO_START_MS = 60_000;

/**
 * …and this many moves before the hunt is a failure.
 *
 * Read as: ten peers are tried. The counter is raised each time one is abandoned, and reaching
 * ten stops the hunt — so the tenth abandonment is the failure rather than the eleventh attempt.
 */
export const MAX_SWITCHES = 10;

/** How long the network gets to answer a search before what arrived is ranked. */
const SEARCH_WINDOW_MS = 12_000;

/** Once a transfer IS moving, how long it may take. Not in the request, but a peer that sends
 *  two kilobytes and sulks would otherwise leave a blue row spinning for ever. */
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

/** Is this song already filed? Asked BEFORE downloading: `addSong` would refuse it at the end
 *  anyway, and finding out after forty megabytes is a worse way to learn it. */
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

/**
 * Wait on one peer.
 *
 * `stalled` is the sixty-second rule and means "never started". `failed` is the peer saying no —
 * a rejection, an error, a cancellation — and does not wait out the minute, because a peer that
 * has already refused will not change its mind.
 */
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
      // It was there and is gone: slskd drops a transfer it has given up on, and treating
      // that as "still queued" would wait out the whole minute for an answer already given.
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

/** Work down the ranked peers until one of them actually sends the file. */
async function takeFromSomeone(
  sub: string,
  id: string,
  candidates: Candidate[],
  signal: AbortSignal,
): Promise<Candidate> {
  let switches = 0;
  for (const c of candidates) {
    if (switches >= MAX_SWITCHES) break;
    patchHunt(sub, id, {
      status: "downloading",
      peer: c.username,
      switches,
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
    switches += 1;
  }
  throw new Error(
    switches >= MAX_SWITCHES
      ? `${MAX_SWITCHES} pairs essayés, aucun n'a commencé à envoyer`
      : `plus aucun pair à essayer (${switches} essayé${switches > 1 ? "s" : ""})`,
  );
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
    // What a person reading the folder sees about where it came from — the field exists for
    // exactly this, beside `upload` and `k7`.
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

  const text = `${tags.artist} ${tags.title}`;
  const searchId = await startSearch(text);
  let taken: Candidate;
  try {
    const responses = await gather(searchId, signal);
    const candidates = rankCandidates(responses, {
      artist: tags.artist,
      title: tags.title,
    });
    if (!candidates.length)
      throw new Error(
        `personne ne partage « ${text} » dans un format utilisable`,
      );
    taken = await takeFromSomeone(sub, id, candidates, signal);
  } finally {
    await deleteSearch(searchId);
  }

  const { bytes } = await fetchDownload(taken.file.filename);
  const filed = addSong({
    // The peer's own file name, which is what gives the master its extension. `masterName`
    // refuses anything the scan would not see as audio, and `segment` makes the folder.
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
        endedAt: Date.now(),
      });
    })
    .finally(() => {
      running.delete(rec.id);
    });
  return rec;
}

/** Give up on one. The runner's own catch writes the row. */
export function stopHunt(id: string): boolean {
  const ctl = running.get(id);
  if (!ctl) return false;
  ctl.abort();
  return true;
}
