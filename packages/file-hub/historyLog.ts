// historyLog.ts — a room's whole log on disk: append-only segments, full snapshots of the files, checkpoints.
// `entries.jsonl` holds the entries since the room's last save; a save ROLLS it into `log/<firstSeq>.jsonl`, never empties it.
// `log/index.json` knows each segment's first and last seq, so a page reads only the segments it needs.
// Every line and saved state carries the LOG_V that wrote it; a higher one is refused, never replayed.
// See docs/history.md.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { applyFileOp } from "@studio/live-sync/file-op";
import {
  type Conflict,
  isKnownOpKind,
  NeedsUpdate,
  RETIRED_OP_KINDS,
  type Sequenced,
} from "@studio/live-sync/ops";
import { LOG_V } from "@studio/live-sync/protocol";
import type { RoomState } from "@studio/live-sync/room";
import { writeFileAtomic } from "@studio/song/atomicWrite";

export const ENTRIES = "entries.jsonl";
const SEGMENTS = "log";
const SNAPSHOTS = "snapshots";
const CHECKPOINTS = "checkpoints.json";
const SEGMENT_INDEX = "index.json";

/** A named point in a room's order. */
export interface Checkpoint {
  seq: number;
  name: string;
  ts: number;
  /** `auto`, or the email of whoever named it. */
  by: string;
}

/** Thrown when the entries that would rebuild a point were never kept. */
export class HistoryGap extends Error {}

const seqsIn = (dir: string, ext: string): number[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(ext))
        .map((f) => Number(f.slice(0, -ext.length)))
        .filter((n) => Number.isInteger(n) && n >= 0)
        .sort((a, b) => a - b)
    : [];

const segmentSeqs = (dir: string) => seqsIn(join(dir, SEGMENTS), ".jsonl");
const snapshotSeqs = (dir: string) => seqsIn(join(dir, SNAPSHOTS), ".json");

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A version stamp read from disk: absent is 1, the only version written before the stamp. */
function checkVersion(v: unknown, what: string): void {
  const ver = v ?? 1;
  if (typeof ver !== "number" || !Number.isInteger(ver) || ver < 1)
    throw new Error(`${what}: bad log version ${String(ver)}`);
  if (ver > LOG_V)
    throw new NeedsUpdate(
      `${what} written by log version ${ver}, this k7 reads up to ${LOG_V}: update k7`,
    );
}

/** One persisted entry, stamped with the log version that wrote it. */
export const entryLine = (entry: Sequenced): string =>
  `${JSON.stringify({ v: LOG_V, ...entry })}\n`;

/** One line of a log, or null for one a crash cut short or that is no entry; a newer version throws NeedsUpdate. */
export function parseEntryLine(line: string): Sequenced | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const { v, ...entry } = raw;
  checkVersion(v, `entry ${String(entry.seq)}`);
  const batch = entry.batch;
  if (
    typeof entry.seq !== "number" ||
    !isObject(batch) ||
    !Array.isArray(batch.ops) ||
    !Array.isArray(entry.parked)
  )
    return null;
  for (const op of batch.ops)
    if (!isObject(op))
      throw new NeedsUpdate(
        `entry ${entry.seq}: op kind unknown here: update k7`,
      );
  const lost = (batch.ops as { kind?: unknown; file?: unknown }[])
    .filter((op) => isRetired(op.kind))
    .map((op) => String(op.file));
  if (lost.length) unreplayed.set(entry, lost);
  batch.ops = withoutRetired(batch.ops as { kind?: unknown }[]);
  entry.parked = withoutRetiredConflicts(entry.parked as Conflict[]);
  for (const op of batch.ops as { kind?: unknown }[])
    if (!isKnownOpKind(op.kind))
      throw new NeedsUpdate(
        `entry ${entry.seq}: op kind unknown here: update k7`,
      );
  return entry as unknown as Sequenced;
}

/** The files an entry's skipped retired ops changed, which a replay through it can no longer rebuild. */
const unreplayed = new WeakMap<object, string[]>();

/** A workspace file under a YAML name: a point that holds one is from before the workspace was k7x. */
const YAML_NAME = /\.ya?ml$/i;

/** Persisted ops of a retired kind skipped since this process started (docs/history.md). */
let retiredSkipped = 0;

/** How many ops of a retired kind the log and saved states held and were skipped: a count, never a throw. */
export const retiredOpsSkipped = (): number => retiredSkipped;

const isRetired = (kind: unknown): boolean =>
  typeof kind === "string" && RETIRED_OP_KINDS.includes(kind);

/** `ops` without those of a retired kind, each one counted. */
function withoutRetired<T extends { kind?: unknown }>(ops: T[]): T[] {
  const kept = ops.filter((op) => !isRetired(op.kind));
  retiredSkipped += ops.length - kept.length;
  return kept;
}

/** Conflicts without those whose op is of a retired kind, each one counted. */
function withoutRetiredConflicts(list: Conflict[]): Conflict[] {
  const kept = list.filter((c) => !isRetired(c?.op?.kind));
  retiredSkipped += list.length - kept.length;
  return kept;
}

/** A saved room state with its retired ops skipped, in the log and among its conflicts; every entry keeps its seq. */
export function withoutRetiredOps(state: RoomState): RoomState {
  return {
    ...state,
    log: state.log.map((e) => ({
      ...e,
      batch: { ...e.batch, ops: withoutRetired(e.batch.ops) },
      parked: withoutRetiredConflicts(e.parked ?? []),
    })),
    ...(state.conflicts
      ? { conflicts: withoutRetiredConflicts(state.conflicts) }
      : {}),
  };
}

/** A saved room state as written, stamped like the entries. */
export const stateText = (state: object): string =>
  JSON.stringify({ v: LOG_V, ...state });

/** A saved room state read back, its stamp checked and dropped. */
export function parseState<T>(text: string): T {
  const raw = JSON.parse(text);
  if (!isObject(raw)) throw new Error("room state: not an object");
  const { v, ...state } = raw;
  checkVersion(v, "room state");
  return state as T;
}

function readLines(file: string): Sequenced[] {
  if (!existsSync(file)) return [];
  const out: Sequenced[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    // A line a crash cut short was never relayed: skipped, as the relay skips it on load.
    const entry = line ? parseEntryLine(line) : null;
    if (entry) out.push(entry);
  }
  return out;
}

/** Give a room saved before it had segments its log as one, and its saved files as a snapshot; a no-op otherwise. */
export function adoptLegacy(dir: string, state: RoomState | null): void {
  if (existsSync(join(dir, SEGMENTS))) return;
  mkdirSync(join(dir, SEGMENTS), { recursive: true });
  mkdirSync(join(dir, SNAPSHOTS), { recursive: true });
  if (!state || state.head === 0) return;
  const kept = state.log.filter((e) => e.seq <= state.head);
  if (kept.length)
    writeFileAtomic(
      join(dir, SEGMENTS, `${kept[0].seq}.jsonl`),
      kept.map(entryLine).join(""),
    );
  writeSnapshot(dir, state.head, state.files);
}

function writeSnapshot(
  dir: string,
  seq: number,
  files: Record<string, string>,
): void {
  mkdirSync(join(dir, SNAPSHOTS), { recursive: true });
  writeFileAtomic(join(dir, SNAPSHOTS, `${seq}.json`), JSON.stringify(files));
}

/** After the room's state is saved: move `entries.jsonl` into a segment, and snapshot the files when `every` entries passed since the last. */
export function rollLog(
  dir: string,
  head: number,
  files: Record<string, string>,
  every: number,
): void {
  const entries = join(dir, ENTRIES);
  const first = readLines(entries)[0];
  if (first) {
    mkdirSync(join(dir, SEGMENTS), { recursive: true });
    const segment = join(dir, SEGMENTS, `${first.seq}.jsonl`);
    // A name already taken can only hold the same entries' start: appending keeps both, and readers skip a seq seen twice.
    if (existsSync(segment))
      appendFileSync(segment, readFileSync(entries, "utf8"));
    else renameSync(entries, segment);
  }
  writeFileSync(entries, "");
  segmentIndex(dir);
  const last = snapshotSeqs(dir).at(-1) ?? 0;
  if (head - last >= every) writeSnapshot(dir, head, files);
}

/** One segment as the index knows it; `bytes` tells a segment appended to since it was indexed. */
interface SegmentInfo {
  start: number;
  first: number;
  last: number;
  count: number;
  bytes: number;
}

/** The segments, oldest first, from the index; one it lacks or whose length moved is read, and the index rewritten. */
function segmentIndex(dir: string): SegmentInfo[] {
  const logDir = join(dir, SEGMENTS);
  let saved: Record<string, SegmentInfo> = {};
  try {
    const raw = JSON.parse(readFileSync(join(logDir, SEGMENT_INDEX), "utf8"));
    // Only this version's index is trusted; any other is a cache rebuilt from the segments.
    if (raw?.v === LOG_V && isObject(raw.segments)) saved = raw.segments;
  } catch {
    // Missing or torn: rebuilt below from the segments themselves.
  }
  let changed = false;
  const out: SegmentInfo[] = [];
  for (const start of segmentSeqs(dir)) {
    const file = join(logDir, `${start}.jsonl`);
    const bytes = statSync(file).size;
    let info = saved[start];
    if (info?.bytes !== bytes) {
      info = { start, first: start, last: start - 1, count: 0, bytes };
      for (const e of readLines(file)) {
        if (info.count++ === 0 || e.seq < info.first) info.first = e.seq;
        info.last = Math.max(info.last, e.seq);
      }
      changed = true;
    }
    out.push(info);
  }
  if (changed || Object.keys(saved).length !== out.length)
    writeFileAtomic(
      join(logDir, SEGMENT_INDEX),
      JSON.stringify({
        v: LOG_V,
        segments: Object.fromEntries(out.map((i) => [i.start, i])),
      }),
    );
  return out;
}

/** Entries with `after < seq <= upto`, oldest first, read only from the files that can hold them. */
function entriesBetween(dir: string, after: number, upto: number): Sequenced[] {
  const segs = segmentIndex(dir);
  const files = segs
    .filter((s) => s.last > after && s.first <= upto)
    .map((s) => join(dir, SEGMENTS, `${s.start}.jsonl`));
  // The working log holds what follows the last segment.
  if (upto > (segs.at(-1)?.last ?? 0)) files.push(join(dir, ENTRIES));
  const out: Sequenced[] = [];
  let seen = after;
  for (const f of files)
    for (const e of readLines(f))
      if (e.seq > seen && e.seq <= upto) {
        out.push(e);
        seen = e.seq;
      }
  return out;
}

/** Up to `limit` entries before `before`, newest first, reading files from the last back until the page is full. */
export function entriesBefore(
  dir: string,
  before: number,
  limit: number,
): Sequenced[] {
  const segs = segmentIndex(dir);
  const files = segs
    .filter((s) => s.first < before)
    .reverse()
    .map((s) => join(dir, SEGMENTS, `${s.start}.jsonl`));
  if (before > (segs.at(-1)?.last ?? 0) + 1) files.unshift(join(dir, ENTRIES));
  const bySeq = new Map<number, Sequenced>();
  for (const f of files) {
    for (const e of readLines(f)) if (e.seq < before) bySeq.set(e.seq, e);
    if (bySeq.size >= limit) break;
  }
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, limit);
}

/** The last seq the disk holds, without reading the room's saved state. */
export function headOnDisk(dir: string): number {
  const tail = readLines(join(dir, ENTRIES)).at(-1)?.seq ?? 0;
  const seg = segmentIndex(dir).at(-1)?.last ?? 0;
  return Math.max(tail, seg, snapshotSeqs(dir).at(-1) ?? 0);
}

/** Every file's text at `seq`: the nearest snapshot at or before it, and the entries after it replayed; HistoryGap when that would be a guess. */
export function filesAt(dir: string, seq: number): Record<string, string> {
  const snap = snapshotSeqs(dir)
    .filter((s) => s <= seq)
    .at(-1);
  const files = new Map<string, string>(
    snap === undefined
      ? []
      : Object.entries(
          JSON.parse(
            readFileSync(join(dir, SNAPSHOTS, `${snap}.json`), "utf8"),
          ) as Record<string, string>,
        ),
  );
  // With no snapshot at or before it, the empty room at 0 is the base: only valid when the log reaches back to 1.
  const base = snap ?? 0;
  const entries = entriesBetween(dir, base, seq);
  entries.forEach((e, i) => {
    if (e.seq !== base + 1 + i)
      throw new HistoryGap(`seq ${base + 1 + i} is not kept`);
  });
  if (base + entries.length !== seq)
    throw new HistoryGap(`seq ${seq} is not kept`);
  // A file a skipped op changed is a guess until a whole text or a removal replaces it.
  const guessed = new Set<string>();
  for (const e of entries) {
    for (const op of e.batch.ops) {
      const text = applyFileOp(files.get(op.file) ?? null, op);
      if (text === null) files.delete(op.file);
      else files.set(op.file, text);
      if (op.kind !== "k7x") guessed.delete(op.file);
    }
    for (const f of unreplayed.get(e) ?? []) guessed.add(f);
  }
  if (guessed.size)
    throw new HistoryGap(
      `seq ${seq}: ${[...guessed].join(", ")} changed by an edit this k7 no longer replays`,
    );
  const yaml = [...files.keys()].filter((f) => YAML_NAME.test(f));
  if (yaml.length)
    throw new HistoryGap(
      `seq ${seq} is from before this workspace was k7x (${yaml.join(", ")})`,
    );
  return Object.fromEntries(files);
}

export function readCheckpoints(dir: string): Checkpoint[] {
  const file = join(dir, CHECKPOINTS);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as Checkpoint[];
}

export function addCheckpoint(dir: string, cp: Checkpoint): Checkpoint {
  const all = [...readCheckpoints(dir), cp].sort((a, b) => a.seq - b.seq);
  writeFileAtomic(join(dir, CHECKPOINTS), JSON.stringify(all, null, 1));
  return cp;
}
