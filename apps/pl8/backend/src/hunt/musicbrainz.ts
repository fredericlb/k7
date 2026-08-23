// musicbrainz.ts — the tags a hunt files its download under: the closest recording, and the
// release worth calling its album. The CHOICE is pure and tested; the call around it is
// throttled to one a second and named, as their terms require. See ../../docs/hunt.md.

import { normalise, tokens } from "./rank.ts";

/** As much of MusicBrainz's answer as this reads. Their field names, hyphens and all. */
export interface MbRelease {
  title?: string;
  date?: string;
  "release-group"?: {
    "primary-type"?: string | null;
    "secondary-types"?: string[] | null;
  };
}

export interface MbRecording {
  score?: number;
  title?: string;
  length?: number | null;
  "artist-credit"?: { name?: string; artist?: { name?: string } }[];
  releases?: MbRelease[];
}

/** What a hunt needs to name a folder and write a sidecar. */
export interface Tags {
  artist: string;
  title: string;
  album: string | null;
  /** The release date, kept for the history line — it is how you tell two albums apart. */
  date: string | null;
}

/** Their maximum, and it is needed: "nirvana lithium" puts the real recording seventh. */
const LIMIT = 100;

/** What a release being of this kind says about its worth as an album name. */
const PRIMARY: Record<string, number> = {
  album: 300,
  ep: 200,
  single: 150,
  broadcast: 60,
  other: 50,
};

/** …and what its secondary kinds take off — PENALTIES, never exclusions; ../../docs/hunt.md. */
const SECONDARY: Record<string, number> = {
  live: -200,
  bootleg: -250,
  compilation: -150,
  demo: -120,
  remix: -120,
  "dj-mix": -150,
  "mixtape/street": -150,
  interview: -300,
  audiobook: -300,
  spokenword: -300,
};

/** How good an album name this release is — the bootleg trap, in ../../docs/hunt.md. */
export function releaseScore(rel: MbRelease): number {
  const g = rel["release-group"] ?? {};
  const primary = (g["primary-type"] ?? "").toLowerCase();
  let score = PRIMARY[primary] ?? 100;
  for (const s of g["secondary-types"] ?? [])
    score += SECONDARY[s.toLowerCase()] ?? -50;
  return score;
}

/** The album, out of the POOL of every tied recording's releases — kind, then recurrence, then date. */
export function pickAlbum(releases: MbRelease[]): MbRelease | null {
  const groups = new Map<
    string,
    { rel: MbRelease; score: number; count: number; date: string }
  >();
  for (const r of releases) {
    if (!r.title) continue;
    const key = normalise(r.title);
    const score = releaseScore(r);
    const date = r.date || "9999";
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { rel: r, score, count: 1, date });
      continue;
    }
    g.count += 1;
    if (score > g.score) g.score = score;
    // The release KEPT is the earliest pressing, so the date shown is the record's own.
    if (date < g.date) {
      g.date = date;
      g.rel = r;
    }
  }
  const ranked = [...groups.values()].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.count !== b.count) return b.count - a.count;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
  return ranked.length ? ranked[0].rel : null;
}

/** The credited artist — the first credit, which is the one a folder should be named for. */
function artistOf(rec: MbRecording): string {
  const credit = (rec["artist-credit"] ?? [])[0];
  return (credit?.name || credit?.artist?.name || "").trim();
}

/** How well this recording explains what was typed — WHERE the words landed, ../../docs/hunt.md. */
export function queryScore(
  query: string,
  artist: string,
  title: string,
): number {
  const want = tokens(query);
  if (!want.length) return 0;
  const inArtist = new Set(tokens(artist));
  const inTitle = new Set(tokens(title));
  const covered = want.filter((t) => inArtist.has(t) || inTitle.has(t)).length;
  const byArtist = want.filter((t) => inArtist.has(t)).length;
  // Words the title carries that nobody asked for — a compound catalogue entry says so here.
  const surplus = [...inTitle].filter((t) => !want.includes(t)).length;
  return covered * 100 + (byArtist > 0 ? 60 : 0) - surplus * 10;
}

/** The tags to file under: the right RECORDING first, then the right ALBUM across every tie. */
export function chooseTags(
  recordings: MbRecording[],
  query: string,
): Tags | null {
  // Their `score` is deliberately NOT a filter: it is anti-correlated here, ../../docs/hunt.md.
  const usable = recordings.filter((r) => r.title && artistOf(r));
  if (!usable.length) return null;
  const scored = usable.map((rec) => ({
    rec,
    q: queryScore(query, artistOf(rec), rec.title ?? ""),
  }));
  const top = Math.max(...scored.map((s) => s.q));
  const tied = scored.filter((s) => s.q === top);
  const album = pickAlbum(tied.flatMap((s) => s.rec.releases ?? []));
  return {
    artist: artistOf(tied[0].rec),
    title: (tied[0].rec.title ?? "").trim(),
    album: album?.title?.trim() || null,
    date: album?.date || null,
  };
}

/** Every split point at once, OR'd, out of `normalise`d words — see ../../docs/hunt.md. */
export function buildQuery(text: string): string {
  const words = normalise(text).split(" ").filter(Boolean);
  if (!words.length) return "";
  const one = words.join(" ");
  // One word says nothing about which field it belongs to, so ask both.
  if (words.length === 1) return `recording:"${one}" OR artist:"${one}"`;
  const clauses: string[] = [];
  for (let i = 1; i < words.length; i++)
    clauses.push(
      `(artist:"${words.slice(0, i).join(" ")}" AND recording:"${words.slice(i).join(" ")}")`,
    );
  return clauses.join(" OR ");
}

/** Their terms: one request a second, from a client that names itself and says how to reach us. */
const MIN_GAP_MS = 1100;
let lastCall = 0;
let chain: Promise<unknown> = Promise.resolve();

const userAgent = (): string =>
  process.env.MUSICBRAINZ_USER_AGENT ||
  "studio-pl8/0.1 ( https://studio.frediver.se )";

/** One at a time and never faster than the gap — queued rather than dropped. */
function throttled<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return run();
  });
  // The chain must not break on a rejection, or every later search inherits this one's error.
  chain = next.catch(() => undefined);
  return next;
}

/** Ask MusicBrainz what this text is. `null` for "nothing recognisable", never a guess. */
export async function lookup(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Tags | null> {
  const q = query.trim();
  if (!q) return null;
  const ask = (search: string): Promise<MbRecording[]> =>
    throttled(async () => {
      const url = `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(search)}&fmt=json&limit=${LIMIT}`;
      const res = await fetchImpl(url, {
        headers: { "user-agent": userAgent(), accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`musicbrainz ${res.status}`);
      return (
        ((await res.json()) as { recordings?: MbRecording[] }).recordings ?? []
      );
    });
  const fielded = buildQuery(q);
  let found = fielded ? await ask(fielded) : [];
  // No split matched, so fall back on full text: a worse question, but a different one.
  if (!found.length) found = await ask(q);
  return chooseTags(found, q);
}
