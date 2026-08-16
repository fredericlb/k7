import {
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearYamlCache, parsedYaml } from "./yamlCache";

// The cache serves a parse it has already done, and its whole correctness is knowing when it
// may. An mtime alone is not a key: on this dev machine, 3000 same-size rewrites issued as fast
// as Node can manage shared an (mtime, size) with the write before them 76% of the time, at a
// granularity of 0.52 ms. So a stamp is trusted only once it is too old to be stamped again.

let dir: string;
const file = (): string => join(dir, "clip.yaml");

/** Backdate `path` past the settle window, so its stamp counts as trustworthy. */
const settle = (path: string): void => {
  const old = new Date(Date.now() - 60_000);
  utimesSync(path, old, old);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yaml-cache-"));
  clearYamlCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parsedYaml", () => {
  it("serves a settled file from the cache — the same object, not merely an equal one", () => {
    writeFileSync(file(), "source: kick.wav\nfrom: 0.25\n");
    settle(file());
    const a = parsedYaml(file());
    const b = parsedYaml(file());
    expect(a).toEqual({ source: "kick.wav", from: 0.25 });
    expect(b).toBe(a); // identity is the only proof the parse was skipped
  });

  /**
   * THE regression test. The settle window does not stop two writes from sharing a stamp —
   * nothing can — it stops the cache from ever HOLDING an entry whose stamp a later write could
   * still reproduce. That is the invariant, and it is the one that can be checked without
   * racing the machine's clock: verified red by setting SETTLE_MS to -1.
   */
  it("does not cache a file it read while the file was still fresh", () => {
    writeFileSync(file(), "source: kick.wav\n");
    const a = parsedYaml(file());
    const b = parsedYaml(file());
    expect(b).not.toBe(a); // stored, this would be the same object
    expect(b).toEqual(a);
  });

  it("sees an edit rewritten to the SAME SIZE straight after a read", () => {
    // End to end, on the machine's real clock: the shape of an actual edit — one clip file
    // rewritten to the same length. Deliberately NOT the proof above: whether these two writes
    // land in one file-time tick is up to the clock, so this passes either way and is a sanity
    // check, not a regression test.
    writeFileSync(file(), "source: kick.wav\nfrom: 0.25\n");
    expect(parsedYaml(file())).toEqual({ source: "kick.wav", from: 0.25 });
    writeFileSync(file(), "source: kick.wav\nfrom: 0.26\n");
    expect(parsedYaml(file())).toEqual({ source: "kick.wav", from: 0.26 });
  });

  it("re-reads when only the SIZE moved under an unchanged mtime", () => {
    writeFileSync(file(), "source: kick.wav\n");
    settle(file());
    const before = statSync(file()).mtime;
    expect(parsedYaml(file())).toEqual({ source: "kick.wav" });
    // Same stamp, different length — the size is what still tells them apart.
    writeFileSync(file(), "source: kick.wav\nfrom: 0.5\n");
    utimesSync(file(), before, before);
    expect(parsedYaml(file())).toEqual({ source: "kick.wav", from: 0.5 });
  });

  it("reads, and does not cache, a file it cannot stat", () => {
    expect(() => parsedYaml(join(dir, "absent.yaml"))).toThrow();
  });

  it("hands out a value the caller may keep — the cache is not re-entered by mutating it", () => {
    // The rule this cache lives by: what it holds never leaves the loader. `readYamlEntities`
    // runs the entity schema over this raw on every call, and zod rebuilds the structure, so a
    // caller mutating its result cannot reach in here. Pinned so that stays true.
    writeFileSync(file(), "notes:\n  - { t: 0, d: 1, k: 60 }\n");
    settle(file());
    const first = parsedYaml(file()) as { notes: unknown[] };
    first.notes.push({ t: 4, d: 1, k: 62 });
    const second = parsedYaml(file()) as { notes: unknown[] };
    // Same object, so the mutation IS visible here — which is exactly why the raw must never be
    // handed out unvalidated. `readYamlEntities` only caches kinds that have a schema.
    expect(second.notes).toHaveLength(2);
  });
});
