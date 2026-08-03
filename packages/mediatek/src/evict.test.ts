import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { heldManifest, rememberManifest } from "./cache.ts";
import { evict, evictFamily, familyBytes } from "./evict.ts";
import { ensureLayout } from "./layout.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-evict-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

/** A cached file plus the manifest entry that says the cache holds it. `fetchedSec` is the
 *  local mtime, which for a downloaded file IS when it was fetched. */
function cached(
  files: { path: string; bytes: number; fetchedSec: number }[],
): void {
  for (const f of files) {
    const abs = join(root, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, "x".repeat(f.bytes));
    utimesSync(abs, f.fetchedSec, f.fetchedSec);
  }
  rememberManifest(
    "samples",
    files
      .map((f) => ({ path: f.path, bytes: f.bytes, mtime: 1 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}

const has = (rel: string) => existsSync(join(root, rel));

describe("staying under a budget", () => {
  it("does nothing at all when the family already fits", () => {
    cached([{ path: "samples/audio/a.wav", bytes: 100, fetchedSec: 1000 }]);
    const r = evictFamily("samples", 1000);
    expect(r.evicted).toEqual([]);
    expect(r.bytesFreed).toBe(0);
    expect(has("samples/audio/a.wav")).toBe(true);
  });

  it("drops the least recently FETCHED first", () => {
    cached([
      { path: "samples/audio/old.wav", bytes: 100, fetchedSec: 1000 },
      { path: "samples/audio/mid.wav", bytes: 100, fetchedSec: 2000 },
      { path: "samples/audio/new.wav", bytes: 100, fetchedSec: 3000 },
    ]);
    const r = evictFamily("samples", 250);
    expect(r.evicted).toEqual(["samples/audio/old.wav"]);
    expect(has("samples/audio/old.wav")).toBe(false);
    expect(has("samples/audio/mid.wav")).toBe(true);
    expect(has("samples/audio/new.wav")).toBe(true);
    expect(r.after).toBe(200);
  });

  it("drops a file that alone exceeds the budget", () => {
    // The budget is the promise. One 8 GB video must not be able to void it by being
    // bigger than the whole allowance.
    cached([{ path: "samples/video/huge.mp4", bytes: 500, fetchedSec: 1000 }]);
    const r = evictFamily("samples", 100);
    expect(r.evicted).toEqual(["samples/video/huge.mp4"]);
    expect(r.after).toBe(0);
  });

  it("reports what it freed and where it started", () => {
    cached([
      { path: "samples/audio/a.wav", bytes: 300, fetchedSec: 1000 },
      { path: "samples/audio/b.wav", bytes: 300, fetchedSec: 2000 },
    ]);
    const r = evictFamily("samples", 400);
    expect(r.before).toBe(600);
    expect(r.bytesFreed).toBe(300);
    expect(r.after).toBe(300);
  });
});

// THE trap. `diff()` compares the owner's manifest against what the cache REMEMBERS it
// holds — so bytes deleted without the manifest being rewritten are bytes the cache
// believes it still has, for ever. It would never re-fetch them, and the moteur would find
// a missing path while the catalogue insisted everything was fine.
describe("the manifest forgets what was evicted", () => {
  it("drops the evicted entry from the remembered manifest", () => {
    cached([
      { path: "samples/audio/old.wav", bytes: 100, fetchedSec: 1000 },
      { path: "samples/audio/new.wav", bytes: 100, fetchedSec: 3000 },
    ]);
    evictFamily("samples", 150);
    expect(heldManifest("samples").map((e) => e.path)).toEqual([
      "samples/audio/new.wav",
    ]);
  });

  it("KEEPS an entry whose file could not be deleted", () => {
    // Undeletable means still on disk. Forgetting it would have the cache re-fetch over a
    // file it already carries, and under-report its own size for ever after.
    cached([
      { path: "samples/audio/a.wav", bytes: 100, fetchedSec: 1000 },
      { path: "samples/audio/b.wav", bytes: 100, fetchedSec: 2000 },
    ]);
    // A non-empty directory where the file was: rmSync without `recursive` throws EISDIR.
    rmSync(join(root, "samples/audio/a.wav"));
    mkdirSync(join(root, "samples/audio/a.wav"));
    mkdirSync(join(root, "samples/audio/a.wav", "blocker"));
    // …and back-date it, or the fresh mkdir makes it the NEWEST thing here and b.wav gets
    // evicted instead. (That is what this test caught the first time it ran.)
    utimesSync(join(root, "samples/audio/a.wav"), 1000, 1000);
    const r = evictFamily("samples", 150);
    expect(r.failed.map((f) => f.path)).toEqual(["samples/audio/a.wav"]);
    expect(heldManifest("samples").map((e) => e.path)).toContain(
      "samples/audio/a.wav",
    );
  });
});

describe("what the policy does and does not touch", () => {
  it("leaves a family the policy does not name completely alone", () => {
    // The default for `modules` is exactly this: a chain can name any of them, so a
    // missing one fails a project to load. Absent from the policy means never evicted.
    cached([{ path: "samples/audio/a.wav", bytes: 999, fetchedSec: 1 }]);
    const reports = evict({ morceaux: 0 });
    expect(reports.map((r) => r.family)).toEqual(["morceaux"]);
    expect(has("samples/audio/a.wav")).toBe(true);
  });

  it("honours a budget of zero, which is not the same as absent", () => {
    cached([{ path: "samples/audio/a.wav", bytes: 10, fetchedSec: 1 }]);
    const [r] = evict({ samples: 0 });
    expect(r.evicted).toEqual(["samples/audio/a.wav"]);
    expect(has("samples/audio/a.wav")).toBe(false);
  });
});

describe("reporting a family's size", () => {
  it("reads the remembered manifest, not the disk", () => {
    // Deliberately: it is the same number `evictFamily` compares against, so a settings
    // screen showing one and an eviction using the other would disagree on screen.
    cached([
      { path: "samples/audio/a.wav", bytes: 100, fetchedSec: 1 },
      { path: "samples/audio/b.wav", bytes: 250, fetchedSec: 2 },
    ]);
    expect(familyBytes("samples")).toBe(350);
  });

  it("is zero for a family never synced", () => {
    expect(familyBytes("morceaux")).toBe(0);
  });
});
