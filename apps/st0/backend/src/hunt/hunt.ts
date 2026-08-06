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

/**
 * What to ASK slskd, in the order to ask it.
 *
 * The album and the title, then the title alone — and **never the artist**.
 *
 * A Soulseek search is matched against the whole shared path, and the artist is nearly always
 * the folder ABOVE the album: it narrows nothing the album has not already narrowed, and every
 * term added is another way for a legitimate copy to miss. The album is the precise half of the
 * pair, which is why it goes first and why dropping it is what the second attempt does.
 *
 * The artist has not gone away — it is the FILTER on what comes back (`rankCandidates`). Asking
 * broadly and judging strictly is the whole shape of this: a term in the query can only lose
 * results, while a term in the filter can be applied to what the peers actually sent.
 */
export function searchTexts(
  album: string | null | undefined,
  title: string,
): string[] {
  const t = title.trim();
  if (!t) return [];
  const a = (album ?? "").trim();
  // No album — or one that adds nothing — leaves a single attempt rather than the same
  // search run twice, which would only spend a second round of somebody's patience.
  return a ? [`${a} ${t}`, t] : [t];
}

/**
 * Work down the ranked peers until one of them actually sends the file.
 *
 * `tried` is shared ACROSS the searches and is the budget: ten peers in total, not ten per
 * attempt. Otherwise the fallback search would quietly double the worst case to twenty minutes
 * of waiting, and the ten in the request would stop meaning anything.
 *
 * A peer already tried is skipped rather than re-queued — the two searches overlap heavily, and
 * giving the same unmoving queue a second minute is the one thing the switching exists to avoid.
 *
 * `null` for "this round found nobody", so the caller can decide whether another search is left.
 */
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

  // Album then title, then the title alone — never the artist. See `searchTexts`.
  const tried = new Set<string>();
  let taken: Candidate | null = null;
  let why = "";
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
        continue;
      }
      taken = await takeFromSomeone(sub, id, candidates, tried, signal);
      if (taken) break;
      why = `${tried.size} pair${tried.size > 1 ? "s" : ""} essayé${tried.size > 1 ? "s" : ""} pour « ${text} », aucun n'a commencé à envoyer`;
    } finally {
      // NOT awaited: stopping a search and waiting for it to wind down is slskd's housekeeping,
      // not this hunt's outcome, and holding the file up for ten seconds of it would delay the
      // green row for nothing. `releaseSearch` never rejects, so nothing escapes here.
      void releaseSearch(searchId);
    }
  }
  // The LAST reason, which is the one from the narrowest search still standing — and the only
  // one worth showing: "nobody had it" after the title alone is a different fact from the same
  // sentence about the album.
  if (!taken) throw new Error(why || "aucune recherche n'a abouti");

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

/**
 * Le secours : reprendre une ligne échouée et aller chercher le morceau sur YouTube.
 *
 * La MÊME ligne, pas une nouvelle. Elle porte déjà les tags que MusicBrainz a résolus, donc le
 * morceau se range au même endroit qu'il serait allé — et l'historique garde une ligne par
 * morceau voulu plutôt qu'une par tentative, ce qui est la question que quelqu'un se pose en
 * relisant la liste.
 *
 * Renvoie `null` quand la ligne est inconnue ou déjà en cours, ce que la route dit en 404/409 :
 * deux téléchargements écrivant le même dossier gagneraient au hasard.
 */
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
      // Le sidecar dit d'où ça vient, comme il dit `slskd` ou `upload`. Ce n'est pas une
      // étiquette de plus : c'est la seule trace, une fois le dossier rangé, qu'on écoute une
      // piste audio de vidéo et non un disque.
      source: "youtube",
    },
    // Le secours d'un échec : rien n'est là à écraser, et si quelque chose l'est entre-temps,
    // `addSong` refuse — ce qui est la bonne réponse, pas un problème à contourner.
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
