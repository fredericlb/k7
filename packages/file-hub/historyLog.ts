// historyLog.ts — a room's whole log on disk: append-only segments, full snapshots of the files, checkpoints.
// `entries.jsonl` holds the entries since the room's last save; a save ROLLS it into `log/<firstSeq>.jsonl`, never empties it.
// `log/index.json` knows each segment's first and last seq, so a page reads only the segments it needs.
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
import type { Sequenced } from "@studio/live-sync/ops";
import type { RoomState } from "@studio/live-sync/room";

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
export const snapshotSeqs = (dir: string) =>
  seqsIn(join(dir, SNAPSHOTS), ".json");

function readLines(file: string): Sequenced[] {
  if (!existsSync(file)) return [];
  const out: Sequenced[] = [];
  for (const line of readFileSync(file, "utf8").split("\n"))
    if (line) out.push(JSON.parse(line) as Sequenced);
  return out;
}

function writeAtomic(file: string, text: string): void {
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
}

/** Give a room saved before it had segments its log as one, and its saved files as a snapshot; a no-op otherwise. */
export function adoptLegacy(dir: string, state: RoomState | null): void {
  if (existsSync(join(dir, SEGMENTS))) return;
  mkdirSync(join(dir, SEGMENTS), { recursive: true });
  mkdirSync(join(dir, SNAPSHOTS), { recursive: true });
  if (!state || state.head === 0) return;
  const kept = state.log.filter((e) => e.seq <= state.head);
  if (kept.length)
    writeFileSync(
      join(dir, SEGMENTS, `${kept[0].seq}.jsonl`),
      kept.map((e) => `${JSON.stringify(e)}\n`).join(""),
    );
  writeSnapshot(dir, state.head, state.files);
}

function writeSnapshot(
  dir: string,
  seq: number,
  files: Record<string, string>,
): void {
  mkdirSync(join(dir, SNAPSHOTS), { recursive: true });
  writeAtomic(join(dir, SNAPSHOTS, `${seq}.json`), JSON.stringify(files));
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
export interface SegmentInfo {
  start: number;
  first: number;
  last: number;
  count: number;
  bytes: number;
}

/** The segments, oldest first, from the index; one it lacks or whose length moved is read, and the index rewritten. */
export function segmentIndex(dir: string): SegmentInfo[] {
  const logDir = join(dir, SEGMENTS);
  let saved: Record<string, SegmentInfo> = {};
  try {
    saved = JSON.parse(readFileSync(join(logDir, SEGMENT_INDEX), "utf8"));
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
    writeAtomic(
      join(logDir, SEGMENT_INDEX),
      JSON.stringify(Object.fromEntries(out.map((i) => [i.start, i]))),
    );
  return out;
}

/** Entries with `after < seq <= upto`, oldest first, read only from the files that can hold them. */
export function entriesBetween(
  dir: string,
  after: number,
  upto: number,
): Sequenced[] {
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

/** Every file's text at `seq`: the nearest snapshot at or before it, and the entries after it replayed. */
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
  for (const e of entries)
    for (const op of e.batch.ops) {
      const text = applyFileOp(files.get(op.file) ?? null, op);
      if (text === null) files.delete(op.file);
      else files.set(op.file, text);
    }
  return Object.fromEntries(files);
}

export function readCheckpoints(dir: string): Checkpoint[] {
  const file = join(dir, CHECKPOINTS);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, "utf8")) as Checkpoint[];
}

export function addCheckpoint(dir: string, cp: Checkpoint): Checkpoint {
  const all = [...readCheckpoints(dir), cp].sort((a, b) => a.seq - b.seq);
  writeAtomic(join(dir, CHECKPOINTS), JSON.stringify(all, null, 1));
  return cp;
}
