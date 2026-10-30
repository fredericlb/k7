// liveCaptureStart.test.ts — what a capture reads when it starts, and the large texts it keeps out of the room.
// Reads are counted on the real node:fs, so a test proves a file was NOT read, which the ledger cannot show.

import * as fs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { blobRef } from "@studio/live-sync/blob";
import { textHash } from "@studio/live-sync/file-op";
import { MemoryConfirmed } from "@studio/live-sync/replica";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Buffer } from "./liveBlobs.ts";
import { LiveCapture } from "./liveCapture.ts";
import type { Batch } from "./liveLog.ts";
import { isBinary, skip } from "./workspace.ts";

vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  return { ...real, readFileSync: vi.fn(real.readFileSync) };
});

const MIX = 'plugin("mixer")\nparams({ gain: 0.5 })\n';
const NOTES = "- mix the bass\n";
const open: LiveCapture[] = [];
afterEach(() => {
  for (const c of open.splice(0)) c.stop();
});

/** A workspace of `files`, every mtime well settled, and its state folder. */
function workspace(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "live-start-"));
  const past = new Date(Date.now() - 60_000);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
    utimesSync(join(root, rel), past, past);
  }
  const blobDir = join(
    mkdtempSync(join(tmpdir(), "live-start-state-")),
    "blobs",
  );
  return { root, blobDir, index: join(blobDir, "..", "blob-index.json") };
}

function capture(w: ReturnType<typeof workspace>, batches: Batch[] = []) {
  const c = new LiveCapture({
    root: w.root,
    replica: "start",
    skip,
    isBinary,
    onBatch: (b) => batches.push(b),
    blobDir: w.blobDir,
    binarySettleMs: 50,
    quietMs: 50,
    reconcileMs: 0,
  });
  open.push(c);
  return c;
}

/** Which files of the workspace `fn` read, by workspace path. */
function readsDuring(root: string, fn: () => void): string[] {
  const spy = vi.mocked(fs.readFileSync);
  spy.mockClear();
  fn();
  return spy.mock.calls
    .map(([p]) => String(p))
    .filter((p) => p.startsWith(root))
    .map((p) =>
      p
        .slice(root.length + 1)
        .split("\\")
        .join("/"),
    );
}

describe("LiveCapture at start", () => {
  it("knows an unchanged text file by the hash it kept, and reads only the k7x ones", () => {
    const w = workspace({ "song.k7/nodes/mix.k7x": MIX, "NOTES.md": NOTES });
    capture(w).start();
    for (const c of open.splice(0)) c.stop();
    const saved = JSON.parse(readFileSync(w.index, "utf8"));
    expect(saved.texts["NOTES.md"].hash).toBe(textHash(NOTES));
    // Never under `files`, where a k7 that knows only blobs would read it as one.
    expect(saved.files["NOTES.md"]).toBeUndefined();
    expect(saved.texts["song.k7/nodes/mix.k7x"]).toBeUndefined();
    expect(readsDuring(w.root, () => capture(w).start())).toEqual([
      "song.k7/nodes/mix.k7x",
    ]);
  });

  it("reads a text file afresh once its stamp moved", () => {
    const w = workspace({ "NOTES.md": NOTES });
    capture(w).start();
    for (const c of open.splice(0)) c.stop();
    const later = new Date(Date.now() - 30_000);
    utimesSync(join(w.root, "NOTES.md"), later, later);
    expect(readsDuring(w.root, () => capture(w).start())).toEqual(["NOTES.md"]);
  });

  it("against a baseline the disk still matches, reads each file once and sends nothing", async () => {
    const files = { "song.k7/nodes/mix.k7x": MIX, "NOTES.md": NOTES };
    const w = workspace(files);
    const baseline = new MemoryConfirmed();
    for (const [f, t] of Object.entries(files)) baseline.set(f, t);
    const batches: Batch[] = [];
    const c = capture(w, batches);
    const reads = readsDuring(w.root, () => c.start(baseline));
    expect(reads.sort()).toEqual(["NOTES.md", "song.k7/nodes/mix.k7x"]);
    // The first sweep trusts the walk's stamps: nothing is read again.
    expect(readsDuring(w.root, () => c.flushNow({ full: true }))).toEqual([]);
    expect(batches).toEqual([]);
  });
});

describe("a large text that is not k7x", () => {
  it("travels as its blob ref, as an amp model must", async () => {
    const w = workspace({});
    const batches: Batch[] = [];
    capture(w, batches).start();
    const model = JSON.stringify({ weights: Array(40_000).fill(0.125) });
    expect(model.length).toBeGreaterThan(128 * 1024);
    writeFileSync(join(w.root, "amp.json"), model);
    const until = Date.now() + 3000;
    while (!batches.length && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    const id = sha256Buffer(Buffer.from(model));
    expect(batches[0]?.ops).toEqual([
      {
        kind: "text",
        file: "amp.json",
        text: blobRef(id.hash, id.size),
        was: null,
      },
    ]);
  });
});
