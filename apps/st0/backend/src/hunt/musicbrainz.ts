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

/**
 * How many answers to weigh. Their maximum, and it is needed.
 *
 * Measured, not chosen: for "nirvana lithium" MusicBrainz returns 20 510 matches and puts the
 * real recording SEVENTH — behind six tracks merely titled after it.
 */
const LIMIT = 100;

/** What a release being of this kind says about its worth as an album name. */
const PRIMARY: Record<string, number> = {
  album: 300,
  ep: 200,
  single: 150,
  broadcast: 60,
  other: 50,
};

/**
 * …and what its secondary kinds take back off.
 *
 * PENALTIES and not exclusions, deliberately. A search for a song whose studio album nobody has
 * catalogued would otherwise come back with no album at all, and "Album inconnu" is worse than
 * the live record it really is on. A studio album still wins whenever one exists.
 */
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

/**
 * How good an album name this release is.
 *
 * The whole reason this function exists: a plain search for "Nirvana Lithium" comes back with
 * twenty-five live bootlegs before it comes back with Nevermind, and taking the first one would
 * file the song under "1991-10-21: Live in Austin, Texas". That is a folder nobody would find
 * again — and the folder name is derived from these tags, so it is not a label, it is the path.
 */
export function releaseScore(rel: MbRelease): number {
  const g = rel["release-group"] ?? {};
  const primary = (g["primary-type"] ?? "").toLowerCase();
  let score = PRIMARY[primary] ?? 100;
  for (const s of g["secondary-types"] ?? [])
    score += SECONDARY[s.toLowerCase()] ?? -50;
  return score;
}

/**
 * The album to file a song under, out of every release its recordings appeared on.
 *
 * Given the POOL and not one recording's list, because MusicBrainz answers a song like Lithium
 * with a hundred separate recordings — one per concert — each carrying the single release it
 * appeared on. Judged one at a time, the answer is whichever bootleg happened to sort first.
 *
 * Kind is what decides, and then HOW OFTEN. The count is the load-bearing part: an outtakes
 * compilation is typed exactly like a studio album in MusicBrainz — "Orange and Blue" and
 * "Nevermind" both come back as plain Albums — and the only thing that separates them is that
 * the real album recurs across the song's recordings and the curiosity appears once.
 *
 * Date is the last word only, because it cannot be the first: the Nevermind rows MusicBrainz
 * returns for Lithium are all 2021 reissues, so "earliest" would hand the song to the 1996
 * compilation.
 */
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
    // The release KEPT is the earliest pressing, so the date reported is the record's own and
    // not a reissue's: MusicBrainz answers Lithium with Nevermind rows stamped 2011 and 2021,
    // and "Nevermind (2011)" in the history reads as the wrong record.
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

/**
 * How well this recording explains what was typed.
 *
 * The reason this exists rather than trusting MusicBrainz's own `score`: a free-text search is
 * matched across every field at once, so "nirvana lithium" scores a novelty track *titled*
 * "Lithium(nirvana)" exactly as highly as Nirvana's Lithium. Their score cannot separate them
 * because both really do contain both words.
 *
 * What separates them is WHERE the words landed. In a real hit the query splits across the two
 * fields — one word names the artist, the other names the song — while an impostor crams all of
 * it into the title and leaves the artist explaining nothing. Hence the bonus: it is the whole
 * discriminator, not a tweak.
 */
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
  // Words the title carries that nobody asked for. A compound catalogue entry —
  // "Miles Davis: So What (Davis, Adderley u.a.; Ausschnitt)" — contains the query and is
  // still not the recording; the surplus is what says so.
  const surplus = [...inTitle].filter((t) => !want.includes(t)).length;
  return covered * 100 + (byArtist > 0 ? 60 : 0) - surplus * 10;
}

/**
 * The tags to file under, out of everything MusicBrainz answered.
 *
 * Two questions, answered in this order because they fail differently. `queryScore` first picks
 * the right RECORDING — that is what loses a cover, or a catalogue entry that merely contains
 * the words. Then every recording that tied is pooled, and `pickAlbum` picks the right ALBUM
 * out of all their releases at once, which is what avoids filing a song under a bootleg.
 *
 * Pooling the tie rather than following the winner is the point: the recordings that tie are the
 * same song played on a hundred different nights, and no single one of them knows which record
 * the song belongs to. Together they do.
 */
export function chooseTags(
  recordings: MbRecording[],
  query: string,
): Tags | null {
  // Their `score` is deliberately NOT a filter here, and that is measured rather than assumed:
  // for "nirvana lithium" the real recording scores 38 while the covers titled after it score
  // 100. Their score answers "how well does this document match the Lucene query", which is not
  // the question being asked — any floor at all would have thrown the right answer away.
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

/**
 * The search to send, out of the words somebody typed.
 *
 * A plain free-text search does not work here, and that is measured rather than assumed: for
 * "miles davis so what" the top hundred answers contain NO Miles Davis recording of So What at
 * all — the scoring is carried away by entries whose titles happen to hold all four words.
 *
 * We do not know which words are the artist and which are the song, so this asks every way at
 * once: one clause per split point, OR'd, in a single request. Lucene scores whichever clause
 * matches, and the same query answers "artist first" and "title first" without our having to
 * guess which the person meant.
 *
 * Built from `normalise`d words, so the only characters that can reach Lucene are `a-z`, `0-9`
 * and spaces. That is not incidental tidiness: this string is assembled from typed input, and
 * a quote or a `~` in it would otherwise be query syntax rather than a word.
 */
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
  "studio-st0/0.1 ( https://studio.frediver.se )";

/** One at a time, and never faster than the gap — queued rather than dropped, because two
 *  people searching at once is normal and rejecting one of them would be a bug they see. */
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

/**
 * Ask MusicBrainz what this text is.
 *
 * `null` for "nothing recognisable", which the caller reports as such — a hunt that guessed
 * tags from the raw query would file a typo as an artist and leave a folder nobody can find.
 */
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
  // Nothing came back for any split: the words are probably not "artist then title" at all — a
  // misspelling, or a title that happens to contain its artist. The plain search is a worse
  // question but it is a different one, and one extra second is cheaper than a dead hunt.
  if (!found.length) found = await ask(q);
  return chooseTags(found, q);
}
