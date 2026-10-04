// The accounts' cache purge. Silent once wrong either way: a render or a journal deleted while in
// use costs a re-render or an undo, one never deleted fills the volume. packages/song/docs/autoFreeze.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CACHE_TTL_MS,
  purgeStaleHistory,
  purgeStaleRenders,
} from "./staleCaches.ts";

const RENDER_TTL_MS = CACHE_TTL_MS;

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "render-cache-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const NOW = Date.UTC(2026, 9, 4);

/** A render in `account`'s cache, last modified at `mtime` and last read at `atime`. */
function render(account: string, name: string, atime: number, mtime = atime) {
  const dir = join(root, account, ".renders");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, "wav");
  utimesSync(file, new Date(atime), new Date(mtime));
  return file;
}

describe("purgeStaleRenders", () => {
  it("deletes what nobody used for a month, in every account, and keeps the rest", () => {
    const old = render("a", "amp-1.wav", NOW - RENDER_TTL_MS - 1);
    const fresh = render("b", "amp-2.wav", NOW - RENDER_TTL_MS + 60_000);
    expect(purgeStaleRenders(root, NOW)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  // The compile marks a render used on its atime alone; the mtime stays the day it was made.
  it("counts a recent read as a use, however old the file", () => {
    const played = render("a", "amp.wav", NOW - 1000, NOW - 10 * RENDER_TTL_MS);
    expect(purgeStaleRenders(root, NOW)).toBe(0);
    expect(existsSync(played)).toBe(true);
  });

  it("touches nothing outside an account's render cache", () => {
    mkdirSync(join(root, "a", "workspace"), { recursive: true });
    const work = join(root, "a", "workspace", "song.wav");
    writeFileSync(work, "wav");
    utimesSync(work, new Date(0), new Date(0));
    writeFileSync(join(root, "libraries.json"), "{}");
    expect(purgeStaleRenders(root, NOW)).toBe(0);
    expect(existsSync(work)).toBe(true);
  });
});

/** A project journal in `account`'s undo cache, with its blobs, all last touched at `at`. */
function journal(account: string, at: number, blobs: string[] = []) {
  const dir = join(root, account, ".history", "song-0123456789ab");
  mkdirSync(join(dir, "blobs"), { recursive: true });
  const files = [
    join(dir, "journal.json"),
    ...blobs.map((b) => join(dir, "blobs", b)),
  ];
  for (const f of files) {
    writeFileSync(f, "x");
    utimesSync(f, new Date(at), new Date(at));
  }
  return dir;
}

describe("purgeStaleHistory", () => {
  it("deletes a journal nobody used for a month, whole, and keeps a live one", () => {
    const dead = journal("a", NOW - CACHE_TTL_MS - 1, ["1-b0"]);
    const live = journal("b", NOW - 1000);
    expect(purgeStaleHistory(root, NOW)).toBe(1);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live)).toBe(true);
  });

  // An engine purges its copy of a blob after the same month: the one here goes alike.
  it("deletes a live journal's blob older than a month", () => {
    const dir = journal("a", NOW - CACHE_TTL_MS - 1, ["1-b0"]);
    utimesSync(join(dir, "journal.json"), new Date(NOW), new Date(NOW));
    expect(purgeStaleHistory(root, NOW)).toBe(1);
    expect(existsSync(join(dir, "journal.json"))).toBe(true);
    expect(existsSync(join(dir, "blobs", "1-b0"))).toBe(false);
  });
});
