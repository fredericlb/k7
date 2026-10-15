// liveRelay.ts — a file service's link to live sync's relay: one socket for every workspace it captures.
// It reconnects on its own, says hello at the last seq each workspace applied, and re-sends what is unconfirmed.
// A batch leaves only once every blob it names is on the store, and batches leave in the order they were made.
// A FOLLOWING link never sends: a local edit is put back to the room's text (a library on a paired machine).
// See docs/liveCapture.md, ../../file-hub/docs/syncRelay.md and ../../file-hub/docs/blobs.md.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BlobId, blobsOf, parseBlobRef } from "@studio/live-sync/blob";
import { applyFileOp, fileOpFor } from "@studio/live-sync/file-op";
import type { Batch, Sequenced } from "@studio/live-sync/ops";
import type { FromRelay, ToRelay } from "@studio/live-sync/protocol";
import type { Replica } from "@studio/live-sync/replica";
import { HUB_SECRET_HEADER } from "@studio/web-protocol";
import { WebSocket } from "ws";
import { cloneFile } from "./liveBlobs.ts";
import { BlobTransfer, blobsUrl } from "./liveBlobTransfer.ts";
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
  /** Told when another replica's batch ENDS the workspace — deleted, or moved to another server. */
  onEnded?: () => void;
}

/** How a link proves its account: the hub's secret for a service it started, a device token for a machine. */
export type RelayAuth = { secret: string } | { token: string };

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** Downloads running at once, per link. */
const FETCH_AT_ONCE = 3;
/** How long a link that has never connected reads as still connecting rather than offline. */
const CONNECT_GRACE_MS = 8000;

/** Where a workspace's TEXT stands against the relay — docs/liveCapture.md, "Up to date". */
export type TextState = "current" | "offline" | "connecting" | "catching-up";

/** The headers that prove a link's account, on its socket and on the blob store alike. */
export const authHeaders = (auth: RelayAuth): Record<string, string> =>
  "token" in auth
    ? { authorization: `Bearer ${auth.token}` }
    : { [HUB_SECRET_HEADER]: auth.secret };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());

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
  private readonly store: BlobTransfer;
  /** Batches leave one at a time, each once its blobs are on the store. */
  private outbox: Promise<void> = Promise.resolve();
  private readonly queued = new Set<string>();
  private readonly fetching = new Set<string>();
  private fetchSlots = FETCH_AT_ONCE;
  private readonly fetchWaiting: (() => void)[] = [];
  /** The head each workspace's welcome promised since the socket opened; absent until it is welcomed. */
  private readonly target = new Map<string, number>();
  private readonly born = Date.now();
  private everOpen = false;

  constructor(
    private readonly url: string,
    private readonly auth: RelayAuth,
    private readonly log: (msg: string) => void = (m) =>
      console.log(`sync | ${m}`),
    /** Told each time the socket opens: a reconnect may have missed a workspace another replica made. */
    private readonly onOpen: () => void = () => {},
    /** Read-only: adopt the room's state, never seed, join or send a batch. */
    private readonly following = false,
  ) {
    this.store = new BlobTransfer(blobsUrl(url), authHeaders(auth));
  }

  /** Start relaying `l`; says hello at once when the socket is up. */
  add(l: Linked, logDir: string): void {
    this.linked.set(l.name, { ...l, logDir });
    if (!this.ws) this.connect();
    else if (this.ws.readyState === WebSocket.OPEN) this.hello(l.name);
  }

  remove(name: string): void {
    this.linked.delete(name);
    this.target.delete(name);
  }

  /** Whether workspace `name`'s text is the room's: welcomed on the open socket, and every entry since applied. */
  textState(name: string): TextState {
    const l = this.linked.get(name);
    if (!l) return "connecting";
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // At start the socket is still opening: that is no reason to call the relay away.
      const starting =
        !this.everOpen && Date.now() - this.born < CONNECT_GRACE_MS;
      return !starting && l.replica.head > 0 ? "offline" : "connecting";
    }
    const target = this.target.get(name);
    if (target === undefined) return "connecting";
    return l.replica.head < target ? "catching-up" : "current";
  }

  /** A batch the workspace's capture emitted: given to its replica, then sent. */
  local(name: string, batch: Batch): void {
    const l = this.linked.get(name);
    if (!l) return;
    if (this.following) {
      this.restore(
        l,
        batch.ops.map((o) => o.file),
      );
      return;
    }
    l.replica.local(batch);
    this.enqueue(name, batch);
  }

  /** A followed workspace's local edit is undone: each file goes back to the room's text it last applied. */
  private restore(l: Linked, files: string[]): void {
    // Nothing applied yet: the welcome's state is what decides.
    if (l.replica.head === 0) return;
    const put: string[] = [];
    for (const file of new Set(files)) {
      const text = l.replica.confirmed.get(file);
      if (l.capture.read(file) === text) continue;
      l.capture.writeKnown(file, text);
      put.push(file);
    }
    if (!put.length) return;
    this.log(
      `${l.name}: followed read-only, ${put.length} local edit(s) undone`,
    );
    l.onRemote(put);
  }

  /** Bring blob `id` of workspace `name` from the store, then let its capture write the files waiting for it. */
  fetch(name: string, id: BlobId): void {
    const key = `${name}\n${id.hash}`;
    if (this.fetching.has(key)) return;
    this.fetching.add(key);
    void this.fetchLoop(name, id.hash).finally(() => this.fetching.delete(key));
  }

  /** Settle conflict `id`: `take` writes its alternative over the value in place; answers the batch sent, or null. */
  resolve(name: string, id: string, take: boolean): Batch | null {
    if (this.following) return null;
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

  /** Queue `batch` behind every batch before it; one already queued is not queued twice. */
  private enqueue(name: string, batch: Batch): void {
    if (this.queued.has(batch.id)) return;
    this.queued.add(batch.id);
    this.outbox = this.outbox
      .then(() => this.deliver(name, batch))
      .catch((e: Error) => this.log(`${name}: batch not sent: ${e.message}`));
  }

  private async deliver(name: string, batch: Batch): Promise<void> {
    const live = () =>
      !this.closed &&
      (this.linked
        .get(name)
        ?.replica.unconfirmed()
        .some((b) => b.id === batch.id) ??
        false);
    try {
      for (const id of blobsOf(batch.ops))
        await this.retrying(live, () => this.upload(name, id.hash));
    } finally {
      this.queued.delete(batch.id);
    }
    if (live()) this.send({ t: "batch", workspace: name, batch });
  }

  /** Put blob `hash` on the store unless it is there; bytes no longer held anywhere are logged and skipped. */
  private async upload(name: string, hash: string): Promise<void> {
    const capture = this.linked.get(name)?.capture;
    if (!capture) return;
    if (!(await this.store.has(hash))) {
      const file = capture.blobFile(hash);
      if (!file) {
        this.log(
          `${name}: the bytes of blob ${hash} are gone; sent without them`,
        );
        return;
      }
      await this.store.put(hash, file);
    }
    capture.uploaded(hash);
  }

  /** Put on the store every blob this replica holds the bytes of and the store lacks: a ref the room has but no one can fetch. */
  private async heal(name: string): Promise<void> {
    const capture = this.linked.get(name)?.capture;
    if (!capture) return;
    const hashes = new Set<string>();
    for (const file of capture.textFiles()) {
      const id = parseBlobRef(capture.read(file));
      if (id) hashes.add(id.hash);
    }
    let put = 0;
    for (const hash of hashes) {
      if (this.closed) return;
      try {
        if (await this.store.has(hash)) continue;
        const file = capture.blobFile(hash);
        if (!file) continue;
        await this.store.put(hash, file);
        capture.uploaded(hash);
        put++;
      } catch (e) {
        this.log(
          `${name}: blob ${hash} not put on the store: ${(e as Error).message}`,
        );
        return;
      }
    }
    if (put) this.log(`${name}: put ${put} blob(s) the store lacked`);
  }

  private async fetchLoop(name: string, hash: string): Promise<void> {
    const wanted = () =>
      !this.closed && (this.linked.get(name)?.capture.pendingOn(hash) ?? false);
    if (this.fetchSlots > 0) this.fetchSlots--;
    else await new Promise<void>((r) => this.fetchWaiting.push(r));
    try {
      await this.retrying(wanted, async () => {
        const l = this.linked.get(name);
        const cache = l?.capture.blobs;
        if (!l || !cache) return;
        await this.store.get(hash, cache, name);
        const placed = l.capture.fetched(hash);
        if (placed.length) l.onRemote(placed);
      });
    } finally {
      // A slot freed goes straight to the oldest waiter, so no newcomer slips in between.
      const next = this.fetchWaiting.shift();
      if (next) next();
      else this.fetchSlots++;
    }
  }

  /** Run `f` until it succeeds, waiting longer after each failure, for as long as `wanted` holds. */
  private async retrying(
    wanted: () => boolean,
    f: () => Promise<void>,
  ): Promise<void> {
    let wait = RETRY_MIN_MS;
    while (wanted())
      try {
        await f();
        return;
      } catch (e) {
        this.log(`blob store: ${(e as Error).message}; retrying`);
        await sleep(wait);
        wait = Math.min(wait * 2, RETRY_MAX_MS);
      }
  }

  private connect(): void {
    const ws = new WebSocket(this.url, { headers: authHeaders(this.auth) });
    this.ws = ws;
    ws.on("open", () => {
      this.retryMs = RETRY_MIN_MS;
      this.everOpen = true;
      for (const name of this.linked.keys()) this.hello(name);
      this.onOpen();
    });
    ws.on("message", (data) =>
      this.receive(JSON.parse(data.toString()) as FromRelay),
    );
    ws.on("error", (e) => this.log(`relay: ${e.message}`));
    ws.on("close", () => {
      this.ws = null;
      // A new socket is a new hello: what the last welcome promised says nothing about what was missed since.
      this.target.clear();
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
    // What this welcome promises: an empty room has nothing to send, the others everything up to their head.
    this.target.set(l.name, msg.mode === "seed" ? 0 : msg.head);
    // An empty room followed is left empty: a follower has nothing to give it.
    if (msg.mode === "seed") {
      if (!this.following) this.seed(l);
    } else l.replica.conflicts.reset(msg.conflicts ?? []);
    if (msg.mode === "snapshot") {
      if (l.replica.head === 0 && l.replica.confirmed.files().length === 0) {
        if (this.following) this.dropUnknown(l, msg.files);
        else this.firstJoin(l, msg.files);
      }
      const written = this.tracking(l, () =>
        l.replica.adopt(msg.head, msg.files),
      );
      saveHead(l.logDir, l.replica.head);
      if (written.length) l.onRemote(written);
      this.log(
        `${l.name}: adopted the relay's state at ${msg.head} (${written.length} file(s) rewritten)`,
      );
    }
    if (!this.following) {
      for (const batch of l.replica.unconfirmed()) this.enqueue(l.name, batch);
      // Behind the batches, in the same queue: a blob named by an entry ordered earlier may never have reached the store.
      this.outbox = this.outbox.then(() => this.heal(l.name)).catch(() => {});
    }
  }

  /** A follower's first state is the room's alone: a file only here goes. */
  private dropUnknown(l: Linked, files: Record<string, string>): void {
    const gone = l.capture.textFiles().filter((f) => !(f in files));
    for (const file of gone) l.capture.writeKnown(file, null);
    if (gone.length)
      this.log(
        `${l.name}: ${gone.length} file(s) not in the followed room removed`,
      );
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
      const abs = l.capture.pathOf(file);
      // A binary's text is its ref: what is kept aside is its bytes.
      if (parseBlobRef(mine)) {
        if (existsSync(abs)) cloneFile(abs, to);
      } else writeFileSync(to, mine);
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
    if (!this.following && entry.batch.replica !== l.replica.id)
      l.capture.captureFiles(entry.batch.ops.map((o) => o.file));
    let failed: string[] = [];
    const written = this.tracking(l, () => {
      failed = l.replica.remote(entry);
    });
    saveHead(l.logDir, l.replica.head);
    if (written.length) l.onRemote(written);
    // Its own end is the replica that sent it, which lets the workspace go itself.
    if (entry.batch.ends && entry.batch.replica !== l.replica.id) {
      l.onEnded?.();
      return;
    }
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
