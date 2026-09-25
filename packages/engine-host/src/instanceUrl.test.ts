// instanceUrl.test.ts — what a typed instance address reduces to, and what it is refused as.

import { describe, expect, it } from "vitest";
import { normaliseUserOrigin } from "./instanceUrl.ts";

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
