// liveCapture.test.ts — real folders, the real watcher: what a change becomes, and two replicas converging.

import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type BlobId, blobRef } from "@studio/live-sync/blob";
import { textHash } from "@studio/live-sync/file-op";
import type { Sequenced } from "@studio/live-sync/ops";
import { MemoryConfirmed, Replica } from "@studio/live-sync/replica";
import { Room } from "@studio/live-sync/room";
import { afterEach, describe, expect, it } from "vitest";
import { sha256Buffer } from "./liveBlobs.ts";
import { type CaptureOptions, LiveCapture } from "./liveCapture.ts";
import type { Batch } from "./liveLog.ts";
import { isBinary, skip } from "./workspace.ts";

const MIX = "plugin: mixer\nparams:\n  gain: 0.5\n  pan: 0\n";

interface Cap {
  root: string;
  capture: LiveCapture;
  batches: Batch[];
}

const open: LiveCapture[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.stop();
});

function put(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

const read = (root: string, rel: string): string =>
  readFileSync(join(root, rel), "utf8");

function replica(
  name: string,
  files: Record<string, string> = { "song.st0/nodes/mix.yaml": MIX },
  more: Partial<CaptureOptions> = {},
): Cap {
  const root = mkdtempSync(join(tmpdir(), `live-${name}-`));
  for (const [rel, text] of Object.entries(files)) put(root, rel, text);
  const batches: Batch[] = [];
  const capture = new LiveCapture({
    root,
    replica: name,
    skip,
    isBinary,
    onBatch: (b) => batches.push(b),
    quietMs: 50,
    reconcileMs: 0,
    ...more,
  });
  capture.start();
  open.push(capture);
  return { root, capture, batches };
}

/** Wait until `r` has emitted `n` batches, or fail after `ms`. */
async function batches(r: Cap, n: number, ms = 3000): Promise<Batch[]> {
  const until = Date.now() + ms;
  while (r.batches.length < n) {
    if (Date.now() > until)
      throw new Error(`expected ${n} batches, got ${r.batches.length}`);
    await new Promise((res) => setTimeout(res, 20));
  }
  return r.batches;
}

const settle = () => new Promise((res) => setTimeout(res, 300));

describe("LiveCapture", () => {
  it("emits nothing for what was there when it started", async () => {
    const a = replica("start");
    await settle();
    expect(a.batches).toEqual([]);
  });

  it("captures a value edit as one path op", async () => {
    const a = replica("value");
    put(a.root, "song.st0/nodes/mix.yaml", MIX.replace("0.5", "0.8"));
    const [b] = await batches(a, 1);
    expect(b.ops).toEqual([
      {
        kind: "yaml",
        file: "song.st0/nodes/mix.yaml",
        ops: [
          { op: "set", path: ["params", "gain"], yaml: "0.8\n", was: "0.5\n" },
        ],
      },
    ]);
  });

  it("captures a new file as text and a deleted one as a removal", async () => {
    const a = replica("create");
    put(a.root, "song.st0/TODOS.md", "- mix\n");
    await batches(a, 1);
    rmSync(join(a.root, "song.st0/nodes/mix.yaml"));
    const all = await batches(a, 2);
    expect(all[0].ops).toEqual([
      { kind: "text", file: "song.st0/TODOS.md", text: "- mix\n", was: null },
    ]);
    expect(all[1].ops).toEqual([
      { kind: "remove", file: "song.st0/nodes/mix.yaml", was: textHash(MIX) },
    ]);
  });

  it("captures a folder renamed whole as removals and creations", async () => {
    const a = replica("rename");
    renameSync(join(a.root, "song.st0"), join(a.root, "tune.st0"));
    const [b] = await batches(a, 1);
    expect(b.ops).toContainEqual({
      kind: "remove",
      file: "song.st0/nodes/mix.yaml",
      was: textHash(MIX),
    });
    expect(b.ops).toContainEqual({
      kind: "text",
      file: "tune.st0/nodes/mix.yaml",
      text: MIX,
      was: null,
    });
  });

  it("ignores what the workspace hides", async () => {
    const a = replica("hidden");
    put(a.root, ".git/HEAD", "ref: x\n");
    put(a.root, "song.st0/clips/take.wav.cache", "x");
    put(a.root, "_recycle_bin/old.yaml", "a: 1\n");
    await settle();
    expect(a.batches).toEqual([]);
  });

  it("never sends a binary as text, whatever its extension: it travels as its blob ref", async () => {
    const a = replica("fxp");
    const bytes = Buffer.from([0x43, 0x63, 0x6e, 0x4b, 0, 0, 1, 2]);
    writeFileSync(join(a.root, "song.st0/preset.fxp"), bytes);
    const [b] = await batches(a, 1);
    const ref = refOf(bytes);
    expect(b.ops).toEqual([
      { kind: "text", file: "song.st0/preset.fxp", text: ref, was: null },
    ]);
    expect(a.capture.read("song.st0/preset.fxp")).toBe(ref);
  });

  it("sends nothing for a text file rewritten with the same content", async () => {
    const a = replica("touch", { "song.st0/TODOS.md": "- mix\n" });
    await new Promise((r) => setTimeout(r, 1200));
    writeFileSync(join(a.root, "song.st0/TODOS.md"), "- mix\n");
    await settle();
    expect(a.batches).toEqual([]);
  });

  it("makes ONE labelled batch of a mutation window", async () => {
    const a = replica("window");
    a.capture.hold();
    put(a.root, "song.st0/nodes/mix.yaml", MIX.replace("0.5", "0.6"));
    put(a.root, "song.st0/nodes/new.yaml", "plugin: eq\n");
    await settle();
    expect(a.batches).toEqual([]);
    a.capture.release("track mix");
    const [b] = await batches(a, 1);
    expect(b.label).toBe("track mix");
    expect(b.ops.map((o) => o.file).sort()).toEqual([
      "song.st0/nodes/mix.yaml",
      "song.st0/nodes/new.yaml",
    ]);
  });

  it("re-scans everything when asked, for the events a watcher dropped", async () => {
    const a = replica("sweep");
    a.capture.stop();
    put(a.root, "song.st0/nodes/mix.yaml", MIX.replace("pan: 0", "pan: 1"));
    const b = a.capture.flushNow({ full: true });
    expect(b?.ops[0]).toMatchObject({
      kind: "yaml",
      file: "song.st0/nodes/mix.yaml",
    });
  });
});

const refOf = (bytes: Buffer): string => {
  const id = sha256Buffer(bytes);
  return blobRef(id.hash, id.size);
};

/** A capture with a blob cache, binaries settling fast, and the fetches it asks for. */
function withBlobs(name: string, files: Record<string, string> = {}) {
  const missing: BlobId[] = [];
  const blobDir = mkdtempSync(join(tmpdir(), `blobs-${name}-`));
  const c = replica(name, files, {
    blobDir,
    binarySettleMs: 50,
    onMissingBlob: (b) => missing.push(b),
  });
  return Object.assign(c, { missing, blobDir });
}

describe("LiveCapture with binaries", () => {
  it("sends a written audio file once it has settled, keeps its bytes, and names them on removal", async () => {
    const a = withBlobs("wav");
    const bytes = randomBytes(4096);
    writeFileSync(join(a.root, "take.wav"), bytes);
    const [b] = await batches(a, 1);
    const ref = refOf(bytes);
    expect(b.ops).toEqual([
      { kind: "text", file: "take.wav", text: ref, was: null },
    ]);
    const path = a.capture.blobFile(sha256Buffer(bytes).hash);
    expect(path && readFileSync(path).equals(bytes)).toBe(true);
    rmSync(join(a.root, "take.wav"));
    const all = await batches(a, 2);
    expect(all[1].ops).toEqual([
      { kind: "remove", file: "take.wav", was: textHash(ref) },
    ]);
  });

  it("writes a ref whose bytes it holds, and echoes nothing", async () => {
    const a = withBlobs("place");
    const bytes = randomBytes(2048);
    writeFileSync(join(a.root, "one.wav"), bytes);
    await batches(a, 1);
    a.capture.writeKnown("two.wav", refOf(bytes));
    expect(readFileSync(join(a.root, "two.wav")).equals(bytes)).toBe(true);
    expect(a.capture.read("two.wav")).toBe(refOf(bytes));
    expect(a.missing).toEqual([]);
    await settle();
    expect(a.batches).toHaveLength(1);
  });

  it("keeps a ref it lacks the bytes of as pending: asked for, never reported removed, written once fetched", async () => {
    const a = withBlobs("pending");
    const bytes = randomBytes(1024);
    const id = sha256Buffer(bytes);
    a.capture.writeKnown("far.wav", refOf(bytes));
    expect(a.missing).toEqual([id]);
    expect(a.capture.read("far.wav")).toBe(refOf(bytes));
    expect(a.capture.pendingOn(id.hash)).toBe(true);
    expect(a.capture.flushNow({ full: true })).toBeNull();
    writeFileSync(join(a.blobDir, id.hash), bytes);
    expect(a.capture.fetched(id.hash)).toEqual(["far.wav"]);
    expect(readFileSync(join(a.root, "far.wav")).equals(bytes)).toBe(true);
    expect(a.capture.pendingOn(id.hash)).toBe(false);
    await settle();
    expect(a.batches).toEqual([]);
  });

  it("still waits for the bytes after a restart, rather than read their absence as a removal", async () => {
    const a = withBlobs("restart");
    const ref = refOf(randomBytes(512));
    a.capture.writeKnown("far.wav", ref);
    a.capture.stop();
    const confirmed = new MemoryConfirmed();
    confirmed.set("far.wav", ref);
    const again: Batch[] = [];
    const missing: BlobId[] = [];
    const c = new LiveCapture({
      root: a.root,
      replica: "restart",
      skip,
      isBinary,
      onBatch: (b) => again.push(b),
      reconcileMs: 0,
      blobDir: a.blobDir,
      onMissingBlob: (b) => missing.push(b),
    });
    open.push(c);
    c.start(confirmed);
    expect(again).toEqual([]);
    expect(missing).toHaveLength(1);
    expect(c.read("far.wav")).toBe(ref);
  });
});

/** A confirmed store holding the room's files, as a replica current with it would. */
function confirmedOf(room: Room): MemoryConfirmed {
  const c = new MemoryConfirmed();
  for (const [f, t] of room.files) c.set(f, t);
  return c;
}

/** A capture wired to a Replica the way liveRelay.ts wires it, with the room in-process instead of a socket. */
function synced(name: string, room: Room) {
  const c = replica(name);
  const r = new Replica(
    name,
    {
      read: (f) => c.capture.read(f),
      write: (f, t) => c.capture.writeKnown(f, t),
    },
    confirmedOf(room),
    room.head,
  );
  return Object.assign(c, { r, given: 0, outbox: [] as Batch[] });
}

/** What liveRelay.ts does the moment a batch is captured: hand it to the replica, and queue it for the relay. */
function give(c: ReturnType<typeof synced>): void {
  for (; c.given < c.batches.length; c.given++) {
    c.r.local(c.batches[c.given]);
    c.outbox.push(c.batches[c.given]);
  }
}

/** The relay ordering everything `c` has queued. */
function send(c: ReturnType<typeof synced>, room: Room): Sequenced[] {
  give(c);
  return c.outbox.splice(0).map((b) => room.submit(b).entry);
}

/** What liveRelay.ts does with an entry: capture the files' pending edits first, then apply. */
function receive(c: ReturnType<typeof synced>, entry: Sequenced): void {
  if (entry.batch.replica !== c.r.id)
    c.capture.captureFiles(entry.batch.ops.map((o) => o.file));
  give(c);
  expect(c.r.remote(entry)).toEqual([]);
}

function seededRoom(): Room {
  const room = new Room();
  room.submit({
    id: "seed",
    replica: "seed",
    local: 0,
    ts: 0,
    label: "seed",
    ops: [{ kind: "text", file: "song.st0/nodes/mix.yaml", text: MIX }],
  });
  return room;
}

const FILE = "song.st0/nodes/mix.yaml";

describe("two replicas through a room", () => {
  it("converge on two edits to different values of one file, and echo nothing back", async () => {
    const room = seededRoom();
    const a = synced("a", room);
    const b = synced("b", room);
    put(a.root, FILE, MIX.replace("gain: 0.5", "gain: 0.9"));
    put(b.root, FILE, MIX.replace("pan: 0", "pan: -0.25"));
    await batches(a, 1);
    await batches(b, 1);
    const entries = [...send(a, room), ...send(b, room)];
    for (const c of [a, b]) for (const e of entries) receive(c, e);
    expect(read(a.root, FILE)).toBe(room.files.get(FILE));
    expect(read(b.root, FILE)).toBe(room.files.get(FILE));
    expect(room.files.get(FILE)).toContain("gain: 0.9");
    expect(room.files.get(FILE)).toContain("pan: -0.25");
    await settle();
    expect(a.batches).toHaveLength(1);
    expect(b.batches).toHaveLength(1);
  });

  it("keep showing their own edit of a value until the room answers, then the value in place, the other set aside", async () => {
    const room = seededRoom();
    const a = synced("a", room);
    const b = synced("b", room);
    put(a.root, FILE, MIX.replace("gain: 0.5", "gain: 0.1"));
    put(b.root, FILE, MIX.replace("gain: 0.5", "gain: 0.9"));
    await batches(a, 1);
    await batches(b, 1);
    const [fromA] = send(a, room);
    const [fromB] = send(b, room);
    receive(b, fromA);
    expect(read(b.root, FILE)).toContain("gain: 0.9");
    for (const [c, es] of [
      [a, [fromA, fromB]],
      [b, [fromB]],
    ] as const)
      for (const e of es) receive(c, e);
    expect(read(a.root, FILE)).toContain("gain: 0.1");
    expect(read(a.root, FILE)).toBe(read(b.root, FILE));
    expect(fromB.parked).toMatchObject([{ replica: "b", kept: "0.1\n" }]);
  });

  it("send a local edit the watcher has not reported yet BEFORE applying a remote one over it", async () => {
    const room = seededRoom();
    const a = synced("a", room);
    const b = synced("b", room);
    put(b.root, FILE, MIX.replace("pan: 0", "pan: 1"));
    await batches(b, 1);
    const [fromB] = send(b, room);
    // Written and received in the same tick: the watcher cannot have reported it.
    put(a.root, FILE, MIX.replace("gain: 0.5", "gain: 0.1"));
    receive(a, fromB);
    expect(a.batches).toHaveLength(1);
    expect(a.batches[0].ops[0]).toMatchObject({
      kind: "yaml",
      ops: [{ path: ["params", "gain"] }],
    });
    expect(read(a.root, FILE)).toContain("gain: 0.1");
    expect(read(a.root, FILE)).toContain("pan: 1");
    const [fromA] = send(a, room);
    receive(a, fromA);
    receive(b, fromA);
    expect(read(b.root, FILE)).toBe(room.files.get(FILE));
    expect(read(a.root, FILE)).toBe(room.files.get(FILE));
  });
});
