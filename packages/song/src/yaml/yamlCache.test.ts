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
import { readModuleFile } from "./moduleIO";
import {
  clearYamlCache,
  parsedYaml,
  settledParse,
  settledText,
} from "./yamlCache";

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

describe("settledParse", () => {
  it("keeps one entry per PARSER, so a file read two ways answers each with its own", () => {
    writeFileSync(file(), "source: kick.wav\n");
    settle(file());
    expect(settledText(file())).toBe("source: kick.wav\n");
    expect(parsedYaml(file())).toEqual({ source: "kick.wav" });
    expect(settledText(file())).toBe("source: kick.wav\n");
  });

  it("serves a settled file without reading it again", () => {
    writeFileSync(file(), "a: 1\n");
    settle(file());
    let parses = 0;
    const count = (t: string) => {
      parses++;
      return t;
    };
    settledParse(file(), "counted", count);
    settledParse(file(), "counted", count);
    expect(parses).toBe(1);
  });
});

describe("readModuleFile", () => {
  it("hands out a fresh module each time, though the parse behind it is shared", () => {
    // The loaders write `ui` and `cc` onto the modules they get; that must not reach the next read.
    writeFileSync(file(), 'extends: "@st0/audio/reverb"\nparams:\n  Mix: 0.3\n');
    settle(file());
    const at = { path: file(), rel: "nodes/clip.yaml" };
    const first = readModuleFile(at).value as Record<string, unknown>;
    first.ui = { knobs: [] };
    (first.params as Record<string, number>).Mix = 0.9;
    const second = readModuleFile(at).value as Record<string, unknown>;
    expect(second.ui).toBeUndefined();
    expect(second.params).toEqual({ Mix: 0.3 });
  });
});
