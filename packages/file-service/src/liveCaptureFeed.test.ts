// liveCaptureFeed.test.ts — the capture's change feed, which the strudel and module watchers hear instead of watching again.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCapture } from "./liveCapture.ts";
import { isBinary, skip } from "./workspace.ts";

let root = "";
let capture: LiveCapture | null = null;

function start(): LiveCapture {
  root = mkdtempSync(join(tmpdir(), "live-feed-"));
  mkdirSync(join(root, "song.k7"), { recursive: true });
  writeFileSync(join(root, "song.k7", "project.k7x"), 'project("t")\n');
  capture = new LiveCapture({
    root,
    replica: "a",
    skip,
    isBinary,
    onBatch: () => {},
    quietMs: 20,
    reconcileMs: 0,
  });
  capture.start();
  return capture;
}

afterEach(() => {
  capture?.stop();
  capture = null;
  rmSync(root, { recursive: true, force: true });
});

describe("LiveCapture's change feed", () => {
  it("reports a file written on disk, with a generation that moves", async () => {
    const c = start();
    const heard: [string, number][] = [];
    c.onChange((rel, gen) => heard.push([rel, gen]));
    await vi.waitFor(
      () => {
        writeFileSync(join(root, "song.k7", "beat.strudel"), 's("bd")\n');
        expect(heard.map(([rel]) => rel)).toContain("song.k7/beat.strudel");
      },
      { timeout: 5000, interval: 50 },
    );
    expect(c.generation).toBeGreaterThan(0);
    expect(heard.at(-1)?.[1]).toBe(c.generation);
  });

  // A write made for another replica is a change for this process too, watcher or none.
  it("reports a file written for another replica at once", () => {
    const c = start();
    const heard: string[] = [];
    c.onChange((rel) => heard.push(rel));
    c.writeKnown("song.k7/beat.strudel", 's("hh")\n');
    expect(heard).toContain("song.k7/beat.strudel");
  });

  it("is silent once unsubscribed", () => {
    const c = start();
    const heard: string[] = [];
    const off = c.onChange((rel) => heard.push(rel));
    off();
    c.writeKnown("song.k7/beat.strudel", 's("hh")\n');
    expect(heard).toEqual([]);
  });

  it("names its root, which the paths are relative to", () => {
    expect(start().root).toBe(root);
  });
});
