// The stamp walked on the worker must be the one walked inline, to the bit: a cache keyed by one
// and checked by the other would miss forever, or worse, hit across a change. See docs/moduleCache.md.

import {
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startStampWorker, walkInline, walkStamp } from "./stampWalk";

let dir: string;

const write = (rel: string, mtime?: Date): void => {
  const path = join(dir, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, rel, "utf8");
  if (mtime) utimesSync(path, mtime, mtime);
};

beforeAll(async () => {
  expect(await startStampWorker()).toBe(true);
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "stamp-walk-"));
  const old = new Date(Date.now() - 3_600_000);
  write("lib/fx/drive/module.k7x", old);
  write("lib/fx/drive/ui.k7x", old);
  write("lib/fx/drive/assets/ir/hall.wav", old);
  write("lib/fx/verb/module.k7x", old);
  write("lib/fx/verb/dsp.ts", old);
  write("lib/synth/a/b/c/d/e/f/g/deep.k7x", old);
  write("lib/.hidden/module.k7x");
  write("nodes/bass.k7x", old);
  write("exts.json", old);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const roots = (): string[] => [
  join(dir, "lib"),
  join(dir, "nodes"),
  join(dir, "missing"),
];
const files = (): string[] => [
  join(dir, "exts.json"),
  join(dir, "no-such-file"),
];

describe("walkStamp", () => {
  it("answers on the worker what the inline walk answers", () => {
    const inline = walkInline(roots(), files());
    expect(inline.entries).toBeGreaterThan(0);
    expect(walkStamp(roots(), files())).toEqual(inline);
  });

  it("moves with a rename, which keeps the count and the mtime", () => {
    const before = walkStamp(roots(), files());
    renameSync(join(dir, "nodes/bass.k7x"), join(dir, "nodes/lead.k7x"));
    const after = walkStamp(roots(), files());
    expect(after.entries).toBe(before.entries);
    expect(after.hash).not.toBe(before.hash);
    expect(after).toEqual(walkInline(roots(), files()));
  });

  it("moves with a rewrite, and with a stamped file outside the roots", () => {
    const before = walkStamp(roots(), files()).newest;
    write("lib/fx/verb/dsp.ts");
    const rewritten = walkStamp(roots(), files()).newest;
    expect(rewritten).toBeGreaterThan(before);
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(dir, "exts.json"), later, later);
    expect(walkStamp(roots(), files()).newest).toBe(later.getTime());
  });

  it("stops at the depth floor and skips dot entries, both ways", () => {
    const deep = walkInline([join(dir, "lib/synth")], []);
    // a, b, c, d, e, f, g: seven names; deep.k7x sits one level past the floor.
    expect(deep.entries).toBe(7);
    expect(walkStamp([join(dir, "lib/synth")], [])).toEqual(deep);
  });
});
