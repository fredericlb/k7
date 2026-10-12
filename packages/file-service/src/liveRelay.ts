// liveRelay.ts — a file service's link to live sync's relay: one socket for every workspace it captures.
// It reconnects on its own, says hello at the last seq each workspace applied, and re-sends what is unconfirmed.
// See docs/liveCapture.md and ../../file-hub/docs/syncRelay.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { applyFileOp, fileOpFor } from "@studio/live-sync/file-op";
import type { Batch, Sequenced } from "@studio/live-sync/ops";
import type { FromRelay, ToRelay } from "@studio/live-sync/protocol";
import type { Replica } from "@studio/live-sync/replica";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { WebSocket } from "ws";
import type { LiveCapture } from "./liveCapture.ts";

/** One workspace's side of the link. */
export interface Linked {
  name: string;
  capture: LiveCapture;
  replica: Replica;
  /** Every file the replica wrote through its host since the last drain. */
  written: string[];
  /** Told which files another replica's batch (or a rebase) rewrote. */
  onRemote: (files: string[]) => void;
}

/** How a link proves its account: the hub's secret for a service it started, a device token for a machine. */
export type RelayAuth = { secret: string } | { token: string };

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;

/** The last seq a workspace applied, kept beside its log so a restart says hello where it left off. */
export function loadHead(logDir: string): number {
  const file = join(logDir, "head");
  return existsSync(file) ? Number(readFileSync(file, "utf8")) || 0 : 0;
}

function saveHead(logDir: string, head: number): void {
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "head"), String(head));
}

export class RelayLink {
  private ws: WebSocket | null = null;
  private readonly linked = new Map<string, Linked & { logDir: string }>();
  private retryMs = RETRY_MIN_MS;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly auth: RelayAuth,
    private readonly log: (msg: string) => void = (m) =>
      console.log(`sync | ${m}`),
  ) {}

  /** Start relaying `l`; says hello at once when the socket is up. */
  add(l: Linked, logDir: string): void {
    this.linked.set(l.name, { ...l, logDir });
    if (!this.ws) this.connect();
    else if (this.ws.readyState === WebSocket.OPEN) this.hello(l.name);
  }

  remove(name: string): void {
    this.linked.delete(name);
  }

  /** A batch the workspace's capture emitted: given to its replica, then sent. */
  local(name: string, batch: Batch): void {
    const l = this.linked.get(name);
    if (!l) return;
    l.replica.local(batch);
    this.send({ t: "batch", workspace: name, batch });
  }

  /** Settle conflict `id`: `take` writes its alternative over the value in place; answers the batch sent, or null. */
  resolve(name: string, id: string, take: boolean): Batch | null {
    const l = this.linked.get(name);
    const c = l?.replica.conflicts.get(id);
    if (!l || !c) return null;
    const file = c.op.file;
    // An edit of this file not yet captured would be written over: send it first.
    l.capture.captureFiles([file]);
    const before = l.capture.read(file);
    const op = take ? fileOpFor(file, before, applyFileOp(before, c.op)) : null;
    if (op) l.capture.writeKnown(file, applyFileOp(before, op));
    const batch: Batch = {
      id: randomUUID(),
      replica: l.replica.id,
      local: 0,
      ts: Date.now(),
      label: `${take ? "take" : "dismiss"} ${c.label}`,
      ops: op ? [op] : [],
      resolves: [id],
    };
    this.local(name, batch);
    return batch;
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private connect(): void {
    const ws = new WebSocket(this.url, {
      headers:
        "token" in this.auth
          ? { authorization: `Bearer ${this.auth.token}` }
          : { [HUB_SECRET_HEADER]: this.auth.secret },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.retryMs = RETRY_MIN_MS;
      for (const name of this.linked.keys()) this.hello(name);
    });
    ws.on("message", (data) =>
      this.receive(JSON.parse(data.toString()) as FromRelay),
    );
    ws.on("error", (e) => this.log(`relay: ${e.message}`));
    ws.on("close", () => {
      this.ws = null;
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retryMs).unref();
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    });
  }

  private send(msg: ToRelay): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(msg));
  }

  private hello(name: string, since?: number): void {
    const l = this.linked.get(name);
    if (l)
      this.send({
        t: "hello",
        workspace: name,
        since: since ?? l.replica.head,
      });
  }

  private receive(msg: FromRelay): void {
    if (msg.t === "error") {
      this.log(`relay refused: ${msg.error}`);
      return;
    }
    const l = this.linked.get(msg.workspace);
    if (!l) return;
    if (msg.t === "seq") {
      this.sequenced(l, msg.entry);
      return;
    }
    if (msg.mode === "seed") this.seed(l);
    else l.replica.conflicts.reset(msg.conflicts ?? []);
    if (msg.mode === "snapshot") {
      if (l.replica.head === 0 && l.replica.confirmed.files().length === 0)
        this.firstJoin(l, msg.files);
      const written = this.tracking(l, () =>
        l.replica.adopt(msg.head, msg.files),
      );
      saveHead(l.logDir, l.replica.head);
      if (written.length) l.onRemote(written);
      this.log(
        `${l.name}: adopted the relay's state at ${msg.head} (${written.length} file(s) rewritten)`,
      );
    }
    for (const batch of l.replica.unconfirmed())
      this.send({ t: "batch", workspace: l.name, batch });
  }

  /** The room is empty: everything this replica holds as text becomes its first batch. */
  private seed(l: Linked): void {
    const ops = l.capture.textFiles().flatMap((file) => {
      const text = l.capture.read(file);
      return text === null ? [] : [{ kind: "text" as const, file, text }];
    });
    const batch: Batch = {
      id: randomUUID(),
      replica: l.replica.id,
      local: 0,
      ts: Date.now(),
      label: "seed",
      ops,
    };
    l.replica.local(batch);
    this.log(`${l.name}: seeding the relay with ${ops.length} file(s)`);
  }

  /** No shared history with the room: files only here are sent, and the room's version of the rest wins, ours backed up. */
  private firstJoin(
    l: Linked & { logDir: string },
    files: Record<string, string>,
  ): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = join(l.logDir, "displaced", stamp);
    const ops: Batch["ops"] = [];
    let displaced = 0;
    for (const file of l.capture.textFiles()) {
      const mine = l.capture.read(file);
      if (mine === null || files[file] === mine) continue;
      if (!(file in files)) {
        ops.push({ kind: "text", file, text: mine });
        continue;
      }
      const to = join(backup, ...file.split("/"));
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, mine);
      displaced++;
    }
    if (ops.length)
      l.replica.local({
        id: randomUUID(),
        replica: l.replica.id,
        local: 0,
        ts: Date.now(),
        label: "join",
        ops,
      });
    this.log(
      `${l.name}: joined the relay — ${ops.length} file(s) only here sent, ${displaced} differing kept in ${backup}`,
    );
  }

  private sequenced(l: Linked & { logDir: string }, entry: Sequenced): void {
    // A local edit the watcher has not reported would be absorbed by what this entry writes: send it first.
    if (entry.batch.replica !== l.replica.id)
      l.capture.captureFiles(entry.batch.ops.map((o) => o.file));
    let failed: string[] = [];
    const written = this.tracking(l, () => {
      failed = l.replica.remote(entry);
    });
    saveHead(l.logDir, l.replica.head);
    if (written.length) l.onRemote(written);
    if (failed.length) {
      // This replica's text is not the room's: fetch the room's whole state.
      this.log(
        `${l.name}: ${failed.join(", ")} did not apply — asking for the relay's state`,
      );
      this.hello(l.name, -1);
    }
  }

  /** Run `f`, answering the files the replica wrote through its host meanwhile. */
  private tracking(l: Linked, f: () => void): string[] {
    l.written.length = 0;
    f();
    const files = [...new Set(l.written)];
    l.written.length = 0;
    return files;
  }
}
