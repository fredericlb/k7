// `isLoopbackReturn` IS the security of pl8's pairing route: anything it lets through is an
// address somebody else's token can be sent to. So the cases that matter are the ones that
// LOOK like loopback and are not.

import { describe, expect, it } from "vitest";
import { isLoopbackReturn, PAIR_RETURN_PATH, pairUrl } from "./pairing";

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
        "https://studio.frediver.se/pl8",
        `http://127.0.0.1:8780${PAIR_RETURN_PATH}`,
        "n0nce",
      ),
    );
    expect(u.origin).toBe("https://studio.frediver.se");
    expect(u.pathname).toBe("/pl8/api/token/pair");
    expect(u.searchParams.get("return")).toBe(
      "http://127.0.0.1:8780/desktop/pair",
    );
    expect(u.searchParams.get("state")).toBe("n0nce");
  });

  it("keeps pl8's path prefix — resolving against the ORIGIN would hit st0's backend", () => {
    for (const base of ["https://s.test/pl8", "https://s.test/pl8/"]) {
      expect(
        new URL(pairUrl(base, "http://127.0.0.1:1/desktop/pair", "s")).pathname,
      ).toBe("/pl8/api/token/pair");
    }
  });
});
