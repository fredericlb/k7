// The render cache's purge. Silent once wrong either way: a render deleted while still played costs
// a re-render on every reload, one never deleted fills the volume. packages/song/docs/autoFreeze.md.

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
import { purgeStaleRenders, RENDER_TTL_MS } from "./renderCache.ts";

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
  it("deletes what nobody used for 48 h, in every account, and keeps the rest", () => {
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
