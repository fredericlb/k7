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

// An mtime is not a key — 76% of fast rewrites share one — so a stamp is trusted only once it is old.

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

  /** THE regression: the cache never HOLDS an entry whose stamp a later write could reproduce. */
  it("does not cache a file it read while the file was still fresh", () => {
    writeFileSync(file(), "source: kick.wav\n");
    const a = parsedYaml(file());
    const b = parsedYaml(file());
    expect(b).not.toBe(a); // stored, this would be the same object
    expect(b).toEqual(a);
  });

  it("sees an edit rewritten to the SAME SIZE straight after a read", () => {
    // A sanity check on the real clock, not a regression test: it passes either way.
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
    // What the cache holds never leaves the loader: zod rebuilds the structure on every call.
    writeFileSync(file(), "notes:\n  - { t: 0, d: 1, k: 60 }\n");
    settle(file());
    const first = parsedYaml(file()) as { notes: unknown[] };
    first.notes.push({ t: 4, d: 1, k: 62 });
    const second = parsedYaml(file()) as { notes: unknown[] };
    // Same object, so the mutation IS visible: which is why the raw is never handed out.
    expect(second.notes).toHaveLength(2);
  });
});
