import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STUDIO_URL } from "./registryClient.ts";
import {
  normaliseBrowserOrigin,
  normaliseUserOrigin,
  parsePending,
  seedDefault,
} from "./webOrigins.ts";

// Not formatting tests: what `normalise` returns is compared against a browser's `Origin` header, so every case here is a boundary case.

describe("normaliseUserOrigin", () => {
  it("keeps scheme, host and port only", () => {
    expect(normaliseUserOrigin("https://daw.test")).toBe("https://daw.test");
    expect(normaliseUserOrigin("https://daw.test/")).toBe("https://daw.test");
    expect(normaliseUserOrigin("https://daw.test/editor?x=1#f")).toBe(
      "https://daw.test",
    );
    expect(normaliseUserOrigin("http://192.168.1.5:5223/x")).toBe(
      "http://192.168.1.5:5223",
    );
  });

  it("assumes https for a bare host", () => {
    expect(normaliseUserOrigin("daw.test")).toBe("https://daw.test");
    expect(normaliseUserOrigin("  daw.test  ")).toBe("https://daw.test");
  });

  it("lowercases the authority but keeps the port", () => {
    expect(normaliseUserOrigin("HTTPS://DAW.Test:8443")).toBe(
      "https://daw.test:8443",
    );
  });

  it("rejects what cannot be one web UI", () => {
    expect(normaliseUserOrigin("")).toBeNull();
    expect(normaliseUserOrigin("   ")).toBeNull();
    expect(normaliseUserOrigin("ftp://daw.test")).toBeNull();
    expect(normaliseUserOrigin("https://")).toBeNull();
    expect(normaliseUserOrigin("https://*.test")).toBeNull(); // no wildcards
    expect(normaliseUserOrigin("https://user:pw@daw.test")).toBeNull(); // no credentials
  });

  it("handles IPv6 without mistaking it for a port", () => {
    expect(normaliseUserOrigin("http://[::1]:8770")).toBe("http://[::1]:8770");
    expect(normaliseUserOrigin("http://[::1]")).toBe("http://[::1]");
  });

  it("elides the default port so it matches what a browser sends", () => {
    // A browser NEVER puts the default port in `Origin`, so storing the explicit form would create an entry that can never match.
    expect(normaliseUserOrigin("https://daw.test:443")).toBe(
      "https://daw.test",
    );
    expect(normaliseUserOrigin("http://daw.test:80")).toBe("http://daw.test");
    // …but a non-default port is part of the origin and must survive.
    expect(normaliseUserOrigin("https://daw.test:8443")).toBe(
      "https://daw.test:8443",
    );
  });

  it("punycodes an internationalised host the way a browser does", () => {
    expect(normaliseUserOrigin("https://café.test")).toBe(
      "https://xn--caf-dma.test",
    );
  });

  // New, beyond the Rust set: the two ways Node's URL is not enough on its own.
  it("rejects a wildcard hidden in a punycode host", () => {
    // `*` is not a forbidden host code point, so URL parses these happily and nothing ever expands the pattern they look like.
    expect(normaliseUserOrigin("https://*.café.test")).toBeNull();
    expect(normaliseUserOrigin("https://xn--caf-dma.test:*")).toBeNull();
  });
});

describe("normaliseBrowserOrigin", () => {
  it("canonicalises a stored entry the same way", () => {
    expect(normaliseBrowserOrigin("https://DAW.Test:443/x")).toBe(
      "https://daw.test",
    );
  });

  it("rejects credentials in a STORED entry rather than dropping them", () => {
    // The read-path hole: `.origin` silently drops them, so a hand-edited file would grant an origin whose written form nobody approved.
    expect(normaliseBrowserOrigin("https://user:pw@daw.test")).toBeNull();
  });

  it("does not guess a scheme — unlike the prompt, nothing here is a human typing", () => {
    expect(normaliseBrowserOrigin("daw.test")).toBeNull();
    expect(normaliseBrowserOrigin("null")).toBeNull();
    expect(normaliseBrowserOrigin("")).toBeNull();
  });
});

describe("parsePending", () => {
  const NOW = 1_784_560_000_000;
  const file = (...entries: { origin: string; ageMs: number }[]) =>
    JSON.stringify({
      pending: entries.map((e) => ({
        origin: e.origin,
        lastSeen: NOW - e.ageMs,
      })),
    });

  it("offers recently blocked origins newest first", () => {
    const f = file(
      { origin: "https://old.test", ageMs: 60_000 },
      { origin: "https://new.test", ageMs: 1_000 },
    );
    expect(parsePending(f, [], NOW)).toEqual([
      "https://new.test",
      "https://old.test",
    ]);
  });

  it("never offers an origin that is already allowed", () => {
    const f = file({ origin: "https://daw.test", ageMs: 1_000 });
    expect(parsePending(f, ["https://daw.test"], NOW)).toEqual([]);
  });

  it("drops entries older than the TTL", () => {
    const f = file({ origin: "https://stale.test", ageMs: 31 * 60 * 1000 });
    expect(parsePending(f, [], NOW)).toEqual([]);
  });

  it("a broken file offers nothing rather than throwing", () => {
    expect(parsePending("", [], NOW)).toEqual([]);
    expect(parsePending("{ this is not json", [], NOW)).toEqual([]);
    expect(parsePending('{"pending": "nope"}', [], NOW)).toEqual([]);
    expect(parsePending('{"pending": [{"nope": 1}]}', [], NOW)).toEqual([]);
  });
});

describe("seedDefault", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-seed-"));
    path = join(dir, "web-origins.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("seeds the hosted studio when no file exists", () => {
    seedDefault(path);
    expect(readFileSync(path, "utf8")).toContain(DEFAULT_STUDIO_URL);
  });

  it("never touches an existing file, even an empty list", () => {
    // An empty list is a choice — the user removed everything — and re-seeding it would make removal impossible.
    writeFileSync(path, '{"origins": []}', "utf8");
    seedDefault(path);
    expect(readFileSync(path, "utf8")).toBe('{"origins": []}');
  });
});
