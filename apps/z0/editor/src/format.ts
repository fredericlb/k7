// session.ts — a `.z0` folder read as one object: session.yaml plus every categories/*.yaml.
// Held as yaml Documents rather than plain values, so an edit rewrites the ONE scalar it
// touched and leaves every comment, quote style and key order exactly as written.
// The vocabulary is apps/z0/docs/projects.md; the round-trip rule is docs/editing.md.

import { type Document, parseDocument, Scalar } from "yaml";

/** The modes a category may be played in; absent is the normal mode. */
export const MODES = [
  "one",
  "free",
  "slow",
  "fusion",
  "reversed",
  "mystery",
  "multi",
] as const;

/** The per-song processing the format still carries, as `effects: { … }`. */
export const EFFECT_KEYS = [
  "speed",
  "pitch",
  "pitchvar",
  "chorus",
  "lowpass",
  "highpass",
  "bitreduction",
  "overdrive",
  "phaser",
] as const;

/** The text of a document, with a bare `- pause:` written bare — see ../../docs/editing.md. */
export function serialize(doc: Document): string {
  return doc.toString({ nullStr: "" });
}

/** A string as a scalar, kept a literal block when it has newlines — ../../docs/editing.md. */
function text(value: string): Scalar {
  const s = new Scalar(value);
  if (value.includes("\n")) s.type = Scalar.BLOCK_LITERAL;
  return s;
}

/** One track: an address (médiathèque, project file, or youtube) plus the window played. */
export interface Track {
  song?: string;
  file?: string;
  youtube?: string;
  start?: number;
  end?: number;
  artist?: string;
  title?: string;
}

/** A song is one track written flat, or several under `tracks:`. `flat` remembers which. */
export interface Song {
  label?: string;
  answer?: string;
  status?: string;
  liveOnly?: boolean;
  speed?: number;
  /** `effects: { chorus: 37, lowpass: 57 }` — the processing applied to this song alone. */
  effects?: Record<string, number>;
  tracks: Track[];
  flat: boolean;
}

export interface Category {
  slug: string;
  name?: string;
  mode?: string;
  variant?: string;
  notice?: string;
  illustration?: string;
  liveOnly?: boolean;
  songs: Song[];
}

/** An order entry names a category (optionally a slice of it) or is a pause. */
export interface OrderEntry {
  kind: "cat" | "pause";
  cat?: string;
  songs?: string;
  message?: string;
}

export interface Session {
  name?: string;
  token?: string;
  password?: string;
  notice?: string;
  order: OrderEntry[];
}

/** A 1-based inclusive range with an optional open end — `1-5`, `11-`, or a bare `7`. */
export interface SongRange {
  from: number;
  to: number | null;
}

const TRACK_KEYS = [
  "song",
  "file",
  "youtube",
  "start",
  "end",
  "artist",
  "title",
];

/** `1-5`, `11-` or `7`; null for anything else, which the caller reads as the whole category. */
export function parseRange(spec: string | undefined): SongRange | null {
  if (!spec) return null;
  const m = /^(\d+)\s*(-)?\s*(\d+)?$/.exec(spec.trim());
  if (!m) return null;
  const from = Number(m[1]);
  if (!m[2]) return { from, to: from };
  return { from, to: m[3] ? Number(m[3]) : null };
}

/** The songs an order entry actually plays, 1-based and inclusive at both ends. */
export function songsInRange(songs: Song[], spec: string | undefined): Song[] {
  const r = parseRange(spec);
  if (!r) return songs;
  return songs.slice(r.from - 1, r.to === null ? undefined : r.to);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function readTrack(raw: Record<string, unknown>): Track {
  return {
    song: str(raw.song),
    file: str(raw.file),
    youtube: str(raw.youtube),
    start: num(raw.start),
    end: num(raw.end),
    artist: str(raw.artist),
    title: str(raw.title),
  };
}

function readEffects(v: unknown): Record<string, number> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    if (typeof val === "number") out[k] = val;
  return Object.keys(out).length ? out : undefined;
}

function readSong(raw: Record<string, unknown>): Song {
  const nested = Array.isArray(raw.tracks) ? raw.tracks : null;
  return {
    label: str(raw.label),
    answer: str(raw.answer),
    status: str(raw.status),
    liveOnly: typeof raw.liveOnly === "boolean" ? raw.liveOnly : undefined,
    speed: num(raw.speed),
    effects: readEffects(raw.effects),
    // A flat song reads as a one-track song here, so nothing downstream branches on the shape.
    flat: !nested,
    tracks: nested
      ? nested.map((t) => readTrack((t ?? {}) as Record<string, unknown>))
      : [readTrack(raw)],
  };
}

export function readCategory(slug: string, doc: Document): Category {
  const raw = (doc.toJS() ?? {}) as Record<string, unknown>;
  const songs = Array.isArray(raw.songs) ? raw.songs : [];
  return {
    slug,
    name: str(raw.name),
    mode: str(raw.mode),
    variant: str(raw.variant),
    notice: str(raw.notice),
    illustration: str(raw.illustration),
    liveOnly: typeof raw.liveOnly === "boolean" ? raw.liveOnly : undefined,
    songs: songs.map((s) => readSong((s ?? {}) as Record<string, unknown>)),
  };
}

export function readSession(doc: Document): Session {
  const raw = (doc.toJS() ?? {}) as Record<string, unknown>;
  const order = Array.isArray(raw.order) ? raw.order : [];
  return {
    name: str(raw.name),
    token: str(raw.token),
    password: str(raw.password),
    notice: str(raw.notice),
    order: order.map((e): OrderEntry => {
      const o = (e ?? {}) as Record<string, unknown>;
      // `- pause:` parses to a null value, so the KEY tells the two apart and never the value.
      if ("pause" in o)
        return { kind: "pause", message: str(o.pause) ?? undefined };
      return { kind: "cat", cat: str(o.cat), songs: rangeText(o.songs) };
    }),
  };
}

/** `songs: 6-` parses as a string, `songs: 7` as a number — both are ranges. */
function rangeText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Where a track's fields live — the ONE place the flat/nested split is spelled out. */
export function trackPath(
  song: Song,
  songIndex: number,
  trackIndex: number,
  key: string,
): (string | number)[] {
  return song.flat
    ? ["songs", songIndex, key]
    : ["songs", songIndex, "tracks", trackIndex, key];
}

/** Set one track field, or REMOVE it when the value is empty — see ../../docs/editing.md. */
export function setTrackField(
  doc: Document,
  song: Song,
  songIndex: number,
  trackIndex: number,
  key: string,
  value: string | number | undefined,
): void {
  const path = trackPath(song, songIndex, trackIndex, key);
  if (value === undefined || value === "") doc.deleteIn(path);
  else doc.setIn(path, value);
}

/** Whether a value means "not set" here; `false` counts, since `liveOnly: false` is never written. */
function empty(v: string | number | boolean | undefined): boolean {
  return v === undefined || v === "" || v === false;
}

function put(
  doc: Document,
  path: (string | number)[],
  value: string | number | boolean | undefined,
): void {
  if (empty(value)) doc.deleteIn(path);
  else if (typeof value === "string") doc.setIn(path, text(value));
  else doc.setIn(path, value);
}

/** Set a song-level field (label, answer, status, …), removing it when emptied. */
export function setSongField(
  doc: Document,
  songIndex: number,
  key: string,
  value: string | number | boolean | undefined,
): void {
  put(doc, ["songs", songIndex, key], value);
}

/** Set one effect, dropping the whole `effects:` map with the last one — ../../docs/editing.md. */
export function setSongEffect(
  doc: Document,
  song: Song,
  songIndex: number,
  key: string,
  value: number | undefined,
): void {
  const rest = { ...(song.effects ?? {}) };
  if (value === undefined) delete rest[key];
  else rest[key] = value;
  if (Object.keys(rest).length === 0)
    doc.deleteIn(["songs", songIndex, "effects"]);
  else doc.setIn(["songs", songIndex, "effects"], doc.createNode(rest));
}

/** Set a category-level field, removing it when emptied. */
export function setCategoryField(
  doc: Document,
  key: string,
  value: string | boolean | undefined,
): void {
  put(doc, [key], value);
}

/** Set a session-level field, removing it when emptied. */
export function setSessionField(
  doc: Document,
  key: string,
  value: string | undefined,
): void {
  put(doc, [key], value);
}

// --- the order of the rounds ------------------------------------------------------------

/** The `order:` sequence of session.yaml, or null when the file has none. */
function orderSeq(doc: Document): { items: unknown[] } | null {
  const seq = doc.getIn(["order"]) as { items?: unknown[] } | undefined;
  return seq && Array.isArray(seq.items) ? (seq as { items: unknown[] }) : null;
}

/** Move a round, carrying its node — so its own comment travels with it. */
export function moveOrderEntry(doc: Document, from: number, to: number): void {
  const seq = orderSeq(doc);
  if (!seq || from === to || from < 0 || to < 0) return;
  if (from >= seq.items.length || to >= seq.items.length) return;
  const [node] = seq.items.splice(from, 1);
  seq.items.splice(to, 0, node);
}

export function removeOrderEntry(doc: Document, index: number): void {
  const seq = orderSeq(doc);
  if (!seq || index < 0 || index >= seq.items.length) return;
  seq.items.splice(index, 1);
}

/** Append a round playing a category — the whole of it until a range is set. */
export function addOrderCat(doc: Document, slug: string): void {
  if (!orderSeq(doc)) {
    doc.setIn(["order"], doc.createNode([{ cat: slug }]));
    return;
  }
  doc.addIn(["order"], doc.createNode({ cat: slug }));
}

/** Append a pause. Its value is the message shown on screen, or null for a bare one. */
export function addOrderPause(doc: Document, message?: string): void {
  const node = { pause: message && message !== "" ? message : null };
  if (!orderSeq(doc)) {
    doc.setIn(["order"], doc.createNode([node]));
    return;
  }
  doc.addIn(["order"], doc.createNode(node));
}

/** Which category a round plays. */
export function setOrderCat(doc: Document, index: number, slug: string): void {
  doc.setIn(["order", index, "cat"], slug);
}

/** The slice of that category — `1-5`, `11-`, or empty for the whole of it. */
export function setOrderRange(
  doc: Document,
  index: number,
  spec: string | undefined,
): void {
  const path = ["order", index, "songs"];
  if (!spec || spec.trim() === "") doc.deleteIn(path);
  else doc.setIn(path, spec.trim());
}

/** A pause's message. Emptied, it becomes a bare `- pause:` rather than losing the pause. */
export function setOrderPause(
  doc: Document,
  index: number,
  message: string | undefined,
): void {
  const path = ["order", index, "pause"];
  if (!message || message === "") doc.setIn(path, new Scalar(null));
  else doc.setIn(path, text(message));
}

/** A fresh `categories/<slug>.yaml`, with the header comment the generator writes. */
export function newCategoryText(name: string): string {
  return `# Une catégorie : son nom affiché, puis ses morceaux.\n# Voir apps/z0/docs/projects.md.\nname: ${JSON.stringify(name)}\nsongs: []\n`;
}

/** Promote a flat song to a `tracks:` list; idempotent — see ../../docs/editing.md. */
export function expandToTracks(
  doc: Document,
  song: Song,
  songIndex: number,
): void {
  if (!song.flat) return;
  const track: Record<string, unknown> = {};
  for (const k of TRACK_KEYS) {
    const v = doc.getIn(["songs", songIndex, k]);
    if (v !== undefined) {
      track[k] = v;
      doc.deleteIn(["songs", songIndex, k]);
    }
  }
  // createNode, not the bare array: `setIn` keeps a plain JS array, which nothing can append to.
  doc.setIn(["songs", songIndex, "tracks"], doc.createNode([track]));
}

/** The `songs:` sequence of a category, or null for a file that has none yet. */
function songSeq(doc: Document): { items: unknown[] } | null {
  const seq = doc.getIn(["songs"]) as { items?: unknown[] } | undefined;
  return seq && Array.isArray(seq.items) ? (seq as { items: unknown[] }) : null;
}

/** Move a song within its category, splicing the NODE so its comments and quoting travel with it. */
export function moveSong(doc: Document, from: number, to: number): void {
  const seq = songSeq(doc);
  if (!seq) return;
  if (from === to || from < 0 || to < 0) return;
  if (from >= seq.items.length || to >= seq.items.length) return;
  const [node] = seq.items.splice(from, 1);
  seq.items.splice(to, 0, node);
}

export function removeSong(doc: Document, index: number): void {
  const seq = songSeq(doc);
  if (!seq || index < 0 || index >= seq.items.length) return;
  seq.items.splice(index, 1);
}

/** Append a song naming one médiathèque address — the flat shape, which is the common one. */
export function addSong(doc: Document, songId: string): void {
  if (!songSeq(doc)) {
    doc.setIn(["songs"], doc.createNode([{ song: songId }]));
    return;
  }
  doc.addIn(["songs"], doc.createNode({ song: songId }));
}

/** Add a track, promoting a flat song first — `song:` and `tracks:` are exclusive in the format. */
export function addTrack(
  doc: Document,
  song: Song,
  songIndex: number,
  songId: string,
): void {
  expandToTracks(doc, song, songIndex);
  doc.addIn(["songs", songIndex, "tracks"], doc.createNode({ song: songId }));
}

/** Remove one track; the last one leaves an empty list — see ../../docs/editing.md. */
export function removeTrack(
  doc: Document,
  song: Song,
  songIndex: number,
  trackIndex: number,
): void {
  if (song.flat) return;
  const seq = doc.getIn(["songs", songIndex, "tracks"]) as
    | { items?: unknown[] }
    | undefined;
  if (seq && Array.isArray(seq.items) && trackIndex < seq.items.length)
    seq.items.splice(trackIndex, 1);
}

/** The category slug a file path names — `categories/stems.yaml` → `stems`. */
export function slugOf(path: string): string {
  return path.replace(/^.*\//, "").replace(/\.ya?ml$/, "");
}

export { parseDocument };
