// trackKind.ts — what a track IS, read off a "[position.][prefix.]label" name prefix
// (e.g. "3.ge.lead"). The prefix drives track order and icon; the position pins a slot.
// Pure string work, no fs, so the browser can import it. Full rationale: docs/trackKind.md.

// The instrument families in layout order (the value is the rank; gaps let a family split later without renumbering).
export const TRACK_FAMILIES = [
  "voice", // vo
  "choir", // ch
  "drums", // da, ds
  "bass", // be, ba, bs
  "guitar", // ge, ga
  "piano", // pi
  "synth", // sy
  "sax", // sx
] as const;

export type TrackFamily = (typeof TRACK_FAMILIES)[number];

// A track with no prefix, or an unknown one, sorts after every named family in its existing order.
const UNKNOWN_RANK = TRACK_FAMILIES.length;

// prefix -> [family, label]; the label is the human name the web app shows as a row's tooltip.
export const TRACK_PREFIXES: Record<
  string,
  [family: TrackFamily, label: string]
> = {
  vo: ["voice", "voix"],
  ch: ["choir", "choeurs"],
  da: ["drums", "batterie acoustique"],
  ds: ["drums", "batterie synthétique"],
  be: ["bass", "basse électrique"],
  ba: ["bass", "basse acoustique"],
  bs: ["bass", "basse synth"],
  ge: ["guitar", "guitare électrique"],
  ga: ["guitar", "guitare acoustique"],
  pi: ["piano", "piano"],
  sy: ["synth", "synthé"],
  sx: ["sax", "saxophone"],
};

// A track name taken apart: "[position.][prefix.]label" — both leading segments are optional and independent.
export interface ParsedTrackName {
  // A 1-based slot the author claims, from a leading all-digits segment; null means "by family".
  position: number | null;
  prefix: string | null; // a known instrument code, lowercased
  label: string; // what's left; the whole name when it declares neither
}

// Take a name apart, case-insensitively; an unrecognised leading segment stays in the label rather than be guessed.
export function parseTrackName(name: string): ParsedTrackName {
  let rest = name;
  let position: number | null = null;
  const num = /^(\d+)\.(?=.)/.exec(rest);
  if (num) {
    position = Number(num[1]);
    rest = rest.slice(num[0].length);
  }
  let prefix: string | null = null;
  const i = rest.indexOf(".");
  if (i > 0) {
    const p = rest.slice(0, i).toLowerCase();
    if (p in TRACK_PREFIXES) {
      prefix = p;
      rest = rest.slice(i + 1);
    }
  }
  return { position, prefix, label: rest };
}

// The instrument code a track name declares, or null. Shorthand for parseTrackName.
export function trackPrefix(name: string): string | null {
  return parseTrackName(name).prefix;
}

// The slot a track name claims (1-based), or null when it claims none.
export function trackPosition(name: string): number | null {
  return parseTrackName(name).position;
}

// The name with its metadata stripped, what a view SHOWS; falls back to the whole name when nothing would remain.
export function trackLabel(name: string): string {
  return parseTrackName(name).label || name;
}

// The family + label a track name declares, or null when it declares none.
export function trackKind(
  name: string,
): { prefix: string; family: TrackFamily; label: string } | null {
  const prefix = trackPrefix(name);
  if (!prefix) return null;
  const [family, label] = TRACK_PREFIXES[prefix];
  return { prefix, family, label };
}

// Where a track sorts: its family's index, or UNKNOWN_RANK for an unprefixed one.
export function trackKindRank(name: string): number {
  const kind = trackKind(name);
  if (kind) return TRACK_FAMILIES.indexOf(kind.family);
  // No prefix: what the name SAYS ("basse", "vox") places it among the families; nothing said, after them all.
  const family = FAMILY_OF[trackCategory(name)];
  return family ? TRACK_FAMILIES.indexOf(family) : UNKNOWN_RANK;
}

// A category's place among the families, for a name that declares no prefix; "other" has none.
const FAMILY_OF: Record<TrackCategory, TrackFamily | null> = {
  vox: "voice",
  drums: "drums",
  bass: "bass",
  guitar: "guitar",
  keys: "piano",
  synth: "synth",
  other: null,
};

/** The order `trackOrder` STATES, or the one the names imply — ONE rule, never both at once (docs/trackKind.md). */
export function orderTracks<T>(
  tracks: T[],
  nameOf: (t: T) => string,
  stated?: readonly string[],
): T[] {
  const at = new Map((stated ?? []).map((id, i) => [id, i] as const));
  if (!at.size) return sortTracksByKind(tracks, nameOf);
  const listed = tracks
    .filter((t) => at.has(nameOf(t)))
    .sort((a, b) => (at.get(nameOf(a)) ?? 0) - (at.get(nameOf(b)) ?? 0));
  // A lane the list forgot follows the ones it names, in family order: an unlisted lane is still a lane.
  const rest = tracks.filter((t) => !at.has(nameOf(t)));
  return [...listed, ...sortTracksByKind(rest, nameOf)];
}

/** Where a reorder lands: a 1-based slot, or the LANE whose place is taken — null when it names neither. */
export function orderPosition(
  order: readonly string[],
  where: string,
): number | null {
  const n = Number(where);
  // A lane id, not an index: a view that CLUSTERS its rows (groups) cannot count slots the file agrees with.
  if (!where.trim() || !Number.isFinite(n)) {
    const at = order.indexOf(where);
    return at < 0 ? null : at + 1;
  }
  return Math.round(n);
}

/** `id` moved to 1-based `position`, clamped — the WHOLE list, since a stated order states all of it. */
export function reorderTracks(
  order: readonly string[],
  id: string,
  position: number,
): string[] {
  const rest = order.filter((x) => x !== id);
  const at = Math.min(Math.max(Math.round(position) - 1, 0), rest.length);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

// Order tracks by instrument family, with any PINNED positions honoured first (stable sort — see docs/trackKind.md).
export function sortTracksByKind<T>(
  tracks: T[],
  nameOf: (t: T) => string,
): T[] {
  const n = tracks.length;
  const slots: (T | undefined)[] = new Array(n);
  const pinned: { t: T; i: number; at: number }[] = [];
  const loose: { t: T; i: number; rank: number }[] = [];

  tracks.forEach((t, i) => {
    const { position } = parseTrackName(nameOf(t));
    if (position === null) loose.push({ t, i, rank: trackKindRank(nameOf(t)) });
    // 1-based and clamped: "0." and "1." both mean first, anything past the end means last.
    else pinned.push({ t, i, at: Math.min(Math.max(position - 1, 0), n - 1) });
  });

  pinned.sort((a, b) => a.at - b.at || a.i - b.i); // lowest slot first, ties keep incoming order
  for (const p of pinned) {
    let at = p.at;
    while (at < n && slots[at] !== undefined) at++;
    if (at >= n) at = slots.findIndex((s) => s === undefined); // every slot down was taken — wrap to the first free one
    slots[at] = p.t;
  }

  loose.sort((a, b) => a.rank - b.rank || a.i - b.i);
  let next = 0;
  for (const l of loose) {
    while (slots[next] !== undefined) next++;
    slots[next] = l.t;
  }
  return slots as T[];
}

// --- Categories: the coarser grouping colours and the default order are drawn by (trackColor.ts) ---

/** The categories, in the order their tracks are laid out. */
export const TRACK_CATEGORIES = [
  "vox",
  "drums",
  "bass",
  "guitar",
  "keys",
  "synth",
  "other",
] as const;

export type TrackCategory = (typeof TRACK_CATEGORIES)[number];

// What a declared instrument family is, as a category: a choir is voices, a sax is one of the rest.
const OF_FAMILY: Record<TrackFamily, TrackCategory> = {
  voice: "vox",
  choir: "vox",
  drums: "drums",
  bass: "bass",
  guitar: "guitar",
  piano: "keys",
  synth: "synth",
  sax: "other",
};

// Words a name or an instrument says itself with; tested in THIS order, since "acoustic drum kit" is drums before it is anything acoustic.
const WORDS: [TrackCategory, RegExp][] = [
  [
    "drums",
    /drum|batterie|kick|snare|hi-?hat|\bhats?\b|perc|cymbal|\bride\b|crash|\btoms?\b|\bkit\b|\b(505|606|707|808|909)\b|breakbeat/,
  ],
  ["vox", /\bvo(x|c|cals?|ice|ix)\b|vocal|chant|choir|ch(o|œ)eur|singer/],
  ["bass", /bass|basse|\bsub\b/],
  ["guitar", /guit|\bgtr\b|\bgt\b|strat|\btele\b|\bfolk\b|riff|\bamp\b/],
  [
    "keys",
    /piano|\bkeys?\b|wurli|rhodes|organ|orgue|\bclav|\bep\b|harpsi|celesta|mellotron/,
  ],
  [
    "synth",
    /synth|\bpoly|\bpad\b|\barp|juno|\bjun\b|moog|pluck|\blead\b|surge|mu-|plaits|braids|tides/,
  ],
];

/** The category a text names, or null when it names none. */
function categoryOfText(text: string): TrackCategory | null {
  const t = text.toLowerCase().replace(/[_.]+/g, " ");
  for (const [cat, re] of WORDS) if (re.test(t)) return cat;
  return null;
}

/** A track's category: its declared prefix, else words in its name, else what its instrument says (`hints`), else "other". */
export function trackCategory(
  name: string,
  hints: readonly string[] = [],
): TrackCategory {
  const { prefix, label } = parseTrackName(name);
  if (prefix) return OF_FAMILY[TRACK_PREFIXES[prefix][0]];
  const said = categoryOfText(label);
  if (said) return said;
  for (const h of hints) {
    const c = categoryOfText(h);
    if (c) return c;
  }
  return "other";
}

/** Where a category's tracks sit: its index in TRACK_CATEGORIES. */
export const categoryRank = (c: TrackCategory): number =>
  TRACK_CATEGORIES.indexOf(c);
