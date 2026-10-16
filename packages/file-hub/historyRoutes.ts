// historyRoutes.ts — an account's sync history, for its browser: each room's log, checkpoints,
// what changed between two points, and a restore. See docs/history.md.
// A restore is an ordinary batch submitted to the LIVE room, so every replica hears it in order.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { textHash } from "@studio/live-sync/file-op";
import type { FileOp, Sequenced } from "@studio/live-sync/ops";
import express, { type Request, type Response, Router } from "express";
import {
  addCheckpoint,
  entriesBefore,
  filesAt,
  HistoryGap,
  headOnDisk,
  readCheckpoints,
} from "./historyLog.ts";
import { isWorkspaceName, type LiveRoom, roomDir } from "./syncRelay.ts";

export { isWorkspaceName };

export interface HistoryOptions {
  /** The account folder its rooms are kept under. */
  accountDir: (slug: string) => string;
  /** The account the session is, or null. */
  slugOf: (req: Request) => string | null;
  /** Who the session is, recorded on a checkpoint it names. */
  userOf: (req: Request) => string;
  /** The relay's live room, or null when no relay runs here: history is then read-only. */
  live: (slug: string, workspace: string) => LiveRoom | null;
}

/** One entry as the history lists it: who, when, which files, and how many ops were set aside. */
interface EntrySummary {
  seq: number;
  ts: number;
  replica: string;
  label: string;
  files: string[];
  parked: number;
}

/** One file that differs between two points; a binary file's value is its blob ref, never diffed as text. */
interface FileChange {
  file: string;
  before: string | null;
  after: string | null;
  binary?: true;
}

/** A binary file travels as a ref starting with NUL. */
const isBlobRef = (v: string | null): boolean =>
  v?.startsWith("\u0000") ?? false;

const summary = (e: Sequenced): EntrySummary => ({
  seq: e.seq,
  ts: e.batch.ts,
  replica: e.batch.replica,
  label: e.batch.label,
  files: [...new Set(e.batch.ops.map((op) => op.file))],
  parked: e.parked.length,
});

/** Every file whose value differs between two sets of files. */
function changes(
  from: Record<string, string>,
  to: Record<string, string>,
): FileChange[] {
  const out: FileChange[] = [];
  for (const file of [
    ...new Set([...Object.keys(from), ...Object.keys(to)]),
  ].sort()) {
    const before = from[file] ?? null;
    const after = to[file] ?? null;
    if (before === after) continue;
    out.push({
      file,
      before,
      after,
      ...(isBlobRef(before) || isBlobRef(after)
        ? { binary: true as const }
        : {}),
    });
  }
  return out;
}

/** The ops that turn `current` into `target`, each naming the text it replaces. */
function restoreOps(
  current: Map<string, string>,
  target: Record<string, string>,
): FileOp[] {
  const ops: FileOp[] = [];
  for (const c of changes(Object.fromEntries(current), target)) {
    const was = c.before === null ? null : textHash(c.before);
    ops.push(
      c.after === null
        ? { kind: "remove", file: c.file, was }
        : { kind: "text", file: c.file, text: c.after, was },
    );
  }
  return ops;
}

const intParam = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

export function historyRouter(opts: HistoryOptions): Router {
  const r = Router();
  r.use(express.json());

  /** The room the request names, or null once an error is answered. */
  const resolve = (req: Request, res: Response) => {
    const slug = opts.slugOf(req);
    if (!slug) {
      res.status(401).json({ error: "no user on the session" });
      return null;
    }
    const workspace = String(req.params.workspace ?? "");
    if (!isWorkspaceName(workspace)) {
      res.status(400).json({ error: "not a workspace name" });
      return null;
    }
    const dir = roomDir(opts.accountDir(slug), workspace);
    if (!existsSync(dir)) {
      res.status(404).json({ error: `no history for ${workspace}` });
      return null;
    }
    // Loading the live room first lets it give an older room's log its segments before anything reads them.
    const live = opts.live(slug, workspace);
    return { dir, live, head: live ? live.room.head : headOnDisk(dir) };
  };

  const fail = (res: Response, e: unknown) => {
    if (e instanceof HistoryGap) res.status(410).json({ error: e.message });
    else res.status(500).json({ error: (e as Error).message });
  };

  r.get("/:workspace", (req, res) => {
    const room = resolve(req, res);
    if (!room) return;
    const before = intParam(req.query.before) ?? room.head + 1;
    const limit = Math.min(500, Math.max(1, intParam(req.query.limit) ?? 50));
    try {
      res.json({
        head: room.head,
        checkpoints: readCheckpoints(room.dir),
        entries: entriesBefore(room.dir, before, limit).map(summary),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:workspace/checkpoints", (req, res) => {
    const room = resolve(req, res);
    if (!room) return;
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const seq =
      req.body?.seq === undefined ? room.head : intParam(req.body.seq);
    if (!name || name.length > 120)
      return void res.status(400).json({ error: "a checkpoint needs a name" });
    if (seq === null || seq > room.head)
      return void res.status(400).json({ error: "no such point" });
    res.json(
      addCheckpoint(room.dir, {
        seq,
        name,
        ts: Date.now(),
        by: opts.userOf(req) || "unknown",
      }),
    );
  });

  r.get("/:workspace/diff", (req, res) => {
    const room = resolve(req, res);
    if (!room) return;
    const from = intParam(req.query.from);
    const to = intParam(req.query.to);
    if (from === null || to === null || from > room.head || to > room.head)
      return void res
        .status(400)
        .json({ error: "from and to must be points of the log" });
    try {
      res.json({
        from,
        to,
        files: changes(filesAt(room.dir, from), filesAt(room.dir, to)),
      });
    } catch (e) {
      fail(res, e);
    }
  });

  r.post("/:workspace/restore", (req, res) => {
    const room = resolve(req, res);
    if (!room) return;
    if (!room.live)
      return void res.status(503).json({ error: "no relay runs here" });
    const seq = intParam(req.body?.seq);
    if (seq === null || seq > room.head)
      return void res.status(400).json({ error: "no such point" });
    try {
      const target = filesAt(room.dir, seq);
      const named = readCheckpoints(room.dir).findLast((c) => c.seq === seq);
      const ops = restoreOps(room.live.room.files, target);
      if (!ops.length) return void res.json({ entry: null });
      const restored = new Set(ops.map((op) => op.file));
      // An alternative to a value the restore replaces is stale: the restore settles it too.
      const resolves = room.live.room.conflicts
        .list()
        .filter((c) => restored.has(c.op.file))
        .map((c) => c.id);
      const entry = room.live.submit({
        id: `history-${randomUUID()}`,
        replica: "history",
        local: 0,
        ts: Date.now(),
        label: `restore to ${named && named.name !== "auto" ? named.name : seq}`,
        ops,
        ...(resolves.length ? { resolves } : {}),
      });
      res.json({ entry: summary(entry) });
    } catch (e) {
      fail(res, e);
    }
  });

  return r;
}
