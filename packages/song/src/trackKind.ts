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

// A track with no prefix, or one whose code isn't below, sorts after every named
// family — "les autres", kept together at the bottom in their existing order.
export const UNKNOWN_RANK = TRACK_FAMILIES.length;

// prefix -> [family, label]. The label is the human name; the web app shows it as the
// track's tooltip so the two-letter code is never the only thing explaining a row.
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
  // A 1-based slot the author is claiming, from a leading all-digits segment. Null when
  // the name doesn't open with one — the track then takes its place by family.
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
  return kind ? TRACK_FAMILIES.indexOf(kind.family) : UNKNOWN_RANK;
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
    // 1-based, and clamped: "0." and "1." both mean first, anything past the end
    // means last.
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
