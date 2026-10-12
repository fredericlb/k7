// `isLoopbackReturn` IS the security of the pairing route: anything it lets through is an
// address somebody else's token can be sent to. So the cases that matter are the ones that
// LOOK like loopback and are not.

import { describe, expect, it } from "vitest";
import {
  isLoopbackReturn,
  normalizeServer,
  PAIR_RETURN_PATH,
  pairUrl,
} from "./pairing";

describe("what a token may be returned to", () => {
  it("accepts the three loopback spellings, on any port", () => {
    for (const u of [
      "http://127.0.0.1:8780/desktop/pair",
      "http://localhost:1/desktop/pair",
      "http://[::1]:65535/desktop/pair",
    ]) {
      expect(isLoopbackReturn(u), u).toBe(true);
    }
  });

  it("refuses anything that is not this machine", () => {
    for (const u of [
      "http://192.168.1.20:8780/desktop/pair", // the LAN is another machine
      "http://10.0.0.5:8780/x",
      "http://evil.test/desktop/pair",
      // Resolves to loopback today; DNS is the sender's to control, not ours.
      "http://localtest.me:8780/x",
      "http://127.0.0.1.evil.test/x",
      "http://[::1].evil.test/x",
    ]) {
      expect(isLoopbackReturn(u), u).toBe(false);
    }
  });

  it("refuses a scheme that is not plain http — there is no certificate for 127.0.0.1", () => {
    for (const u of [
      "https://127.0.0.1:8780/x",
      "app://127.0.0.1/x",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      expect(isLoopbackReturn(u), u).toBe(false);
    }
  });

  it("refuses what is not a URL at all, rather than throwing", () => {
    for (const u of ["", "not a url", "/desktop/pair", "//127.0.0.1/x"]) {
      expect(isLoopbackReturn(u), u).toBe(false);
    }
  });

  it("refuses credentials in the authority, which read as a host to a human", () => {
    expect(isLoopbackReturn("http://127.0.0.1@evil.test/x")).toBe(false);
  });
});

describe("the URL the desktop opens", () => {
  it("carries the return address and the state nonce", () => {
    const u = new URL(
      pairUrl(
        "https://st0.app",
        `http://127.0.0.1:8780${PAIR_RETURN_PATH}`,
        "n0nce",
      ),
    );
    expect(u.origin).toBe("https://st0.app");
    expect(u.pathname).toBe("/api/token/pair");
    expect(u.searchParams.get("return")).toBe(
      "http://127.0.0.1:8780/desktop/pair",
    );
    expect(u.searchParams.get("state")).toBe("n0nce");
  });

  it("keeps a base's path prefix — resolving against the ORIGIN would drop it", () => {
    for (const base of ["https://s.test/studio", "https://s.test/studio/"]) {
      expect(
        new URL(pairUrl(base, "http://127.0.0.1:1/desktop/pair", "s")).pathname,
      ).toBe("/studio/api/token/pair");
    }
  });
});

describe("the server a person types", () => {
  it("is an origin, https when no scheme is given", () => {
    expect(normalizeServer("st0.app")).toBe("https://st0.app");
    expect(normalizeServer(" https://priv.st0.app/some/path ")).toBe(
      "https://priv.st0.app",
    );
    expect(normalizeServer("https://studio.example:8443")).toBe(
      "https://studio.example:8443",
    );
  });

  it("allows plain http only on this machine", () => {
    expect(normalizeServer("http://127.0.0.1:8789")).toBe(
      "http://127.0.0.1:8789",
    );
    expect(normalizeServer("http://192.168.1.10")).toBeNull();
    expect(normalizeServer("http://st0.app")).toBeNull();
  });

  it("refuses what is not a server address", () => {
    for (const bad of [
      "",
      "   ",
      "ftp://st0.app",
      "https://user:pw@st0.app",
      "https://",
    ])
      expect(normalizeServer(bad)).toBeNull();
  });
});
