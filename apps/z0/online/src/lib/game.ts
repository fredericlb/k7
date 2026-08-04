// Pure game-model logic extracted from SoloGame.vue: session flattening,
// fuzzy answer normalization/matching, and the answer-spec parser. Framework-
// free so the matching rules stay testable.

export interface Track {
  artist?: string;
  title?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
}
export interface Song {
  artist?: string;
  title?: string;
  path?: string;
  from?: number;
  to?: number;
  fullSong?: string;
  label?: string;
  notice?: string;
  answer?: string;
  effects?: Record<string, number>;
  tracks?: Track[];
  liveOnly?: boolean;
  code?: string;
}
export interface Category {
  name: string;
  mode?: string;
  notice?: string;
  illustration?: string;
  songs: Song[];
  liveOnly?: boolean;
}
export interface OrderEntry {
  cat?: string;
  from?: number;
  to?: number;
  type?: string;
}
export interface Session {
  categories: Category[];
  order?: OrderEntry[];
}
export interface SoloResume {
  orderIndex: number;
  songIndex: number;
  score: number;
}

export interface Slot {
  kind: "category" | "pause";
  category?: Category;
  songs: Song[];
}

/**
 * A shuffled copy — Fisher–Yates, with the rng injectable so a caller can pin
 * a permutation.
 *
 * Deliberately NOT `sort(() => Math.random() - 0.5)`. A comparator has to be
 * consistent and that one isn't, so the result is biased — and for short
 * arrays V8's sort leaves it close to the original order, which for a playlist
 * means roughly the same tracks first every time. Nothing about the code would
 * ever look wrong.
 *
 * A copy, not in place: `session.categories` is state React holds, and
 * reordering it under the component is how a list re-renders wrong.
 */
export function shuffled<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Flatten a Session into linear slots: pauses dropped (no analogue in solo),
 * liveOnly categories/songs filtered, order from/to slicing applied.
 */
export function buildSlots(session: Session): Slot[] {
  const out: Slot[] = [];
  const skipped: string[] = [];
  const order =
    session.order && session.order.length > 0
      ? session.order
      : session.categories.map((c): OrderEntry => ({ cat: c.name }));
  for (const entry of order) {
    if (entry.type === "pause") {
      skipped.push("pause");
      continue;
    }
    const cat = session.categories.find((c) => c.name === entry.cat);
    if (!cat) continue;
    if (cat.liveOnly) {
      skipped.push(`${cat.name} (category liveOnly)`);
      continue;
    }
    const all = cat.songs ?? [];
    const from =
      entry.from != null ? Math.max(0, Math.min(all.length, entry.from)) : 0;
    const to =
      entry.to != null
        ? Math.max(from, Math.min(all.length, entry.to))
        : all.length;
    const sliced = all.slice(from, to).filter((s) => !s.liveOnly);
    if (sliced.length === 0) {
      skipped.push(`${cat.name} (no songs after liveOnly filter)`);
      continue;
    }
    out.push({ kind: "category", category: cat, songs: sliced });
  }
  if (skipped.length) {
    console.info(
      "[Solo] slots: filtered",
      skipped.length,
      "→",
      skipped.join("; "),
    );
  }
  return out;
}

// Letters that don't decompose under NFD — pre-expand so accent-insensitive
// matching survives (e.g. "Straße" → "strasse", not "stra").
const NON_DECOMPOSABLE_LETTERS: Record<string, string> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ł: "l",
  Ł: "l",
  þ: "th",
  Þ: "th",
  ð: "d",
  Ð: "d",
};

// Articles + the loose "x" are near-universal fluff — dropped symmetrically.
const STOP_WORDS = new Set(["the", "le", "la", "x"]);

/**
 * Fuzzy normalization: lowercase, strip diacritics, tokenize on non-alnum,
 * drop stop-words, concatenate. "AC/DC — Highway to Hell" ≡ "ac dc highway
 * to hell"; "Beatles" ≡ "The Beatles".
 */
export function normalize(s: string): string {
  let expanded = "";
  for (const ch of s) expanded += NON_DECOMPOSABLE_LETTERS[ch] ?? ch;
  const tokenized = expanded
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!tokenized) return "";
  return tokenized
    .split(" ")
    .filter((tok) => !STOP_WORDS.has(tok))
    .join("");
}

// Duet artists are authored "ARTIST1 x ARTIST2"; accept every ordering and
// the common separators ("feat", "et", "avec", or nothing).
const DUET_SPLIT = /\s+x\s+/i;
export function artistVariants(artist: string): string[] {
  const parts = artist
    .split(DUET_SPLIT)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    const n = normalize(artist);
    return n ? [n] : [];
  }
  const seps = ["", "feat", "et", "avec"];
  const variants = new Set<string>();
  const permute = (arr: string[]): string[][] => {
    if (arr.length <= 1) return [arr];
    const out: string[][] = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      for (const p of permute(rest)) out.push([arr[i], ...p]);
    }
    return out;
  };
  for (const perm of permute(parts)) {
    const ns = perm.map((p) => normalize(p));
    if (ns.some((x) => !x)) continue;
    for (const sep of seps) variants.add(ns.join(sep));
  }
  return [...variants];
}

// Damerau-Levenshtein ≤ 1 (substitution, insert/delete, adjacent swap).
// Targets shorter than MIN_FUZZY_LEN require an exact match ("U2" ≠ "U3").
const MIN_FUZZY_LEN = 5;
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.max(a.length, b.length) < MIN_FUZZY_LEN) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let p1 = -1;
    let p2 = -1;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        if (p1 === -1) p1 = i;
        else if (p2 === -1) p2 = i;
        else return false;
      }
    }
    if (p1 === -1 || p2 === -1) return true;
    if (p2 !== p1 + 1) return false;
    return a[p1] === b[p2] && a[p2] === b[p1];
  }
  const shorter = la < lb ? a : b;
  const longer = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] !== longer[j]) {
      if (skipped) return false;
      skipped = true;
      j++;
    } else {
      i++;
      j++;
    }
  }
  return true;
}

export function songArtistTitle(song: Song): { artist: string; title: string } {
  return {
    artist: song.artist || song.tracks?.[0]?.artist || "",
    title: song.title || song.tracks?.[0]?.title || "",
  };
}

/** One acceptable answer: a half-creditable artist/title pair or a plain string. */
export type AnswerAlt =
  | { kind: "pair"; artist: string; title: string }
  | { kind: "plain"; text: string };

/**
 * Parse the song's `answer` field: top-level commas separate alternatives,
 * `[A|B]` becomes a pair, anything else a plain full-string match.
 */
export function parseAnswerSpec(answer: string): AnswerAlt[] {
  const out: AnswerAlt[] = [];
  let depth = 0;
  let buf = "";
  const flush = () => {
    const part = buf.trim();
    buf = "";
    if (!part) return;
    if (part.startsWith("[") && part.endsWith("]")) {
      const inner = part.slice(1, -1);
      const pipe = inner.indexOf("|");
      if (pipe >= 0) {
        out.push({
          kind: "pair",
          artist: inner.slice(0, pipe).trim(),
          title: inner.slice(pipe + 1).trim(),
        });
        return;
      }
    }
    out.push({ kind: "plain", text: part });
  };
  for (const ch of answer) {
    if (ch === "[") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "]") {
      depth = Math.max(0, depth - 1);
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

/** The song's answer model: explicit `answer` or the artist/title fallback. */
export function alternativesFor(song: Song): AnswerAlt[] {
  const explicit = (song.answer ?? "").trim();
  if (explicit) return parseAnswerSpec(explicit);
  const { artist, title } = songArtistTitle(song);
  if (!artist && !title) return [];
  if (!artist || !title) return [{ kind: "plain", text: artist || title }];
  return [{ kind: "pair", artist, title }];
}

export function altDisplay(alt: AnswerAlt): string {
  if (alt.kind === "plain") return alt.text;
  return [alt.artist, alt.title].filter(Boolean).join(" · ");
}

/**
 * Points for a fully-correct guess `elapsedSec` after song start (mirrors
 * multiplayer's buzzer formula: 1000 + a speed kicker decaying over 20s).
 */
export function songScoreAt(elapsedSec: number): number {
  const speedBonus = Math.max(0, Math.round(100 * (1 - elapsedSec / 20)));
  return 1000 + speedBonus;
}
