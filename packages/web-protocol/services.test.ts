// Every service resolves on k7's origin — `docs.` read as `app.`, the `play.` and `k7.` aliases
// stripped, a former host read as its successor; on a loopback host that
// origin is the page's own, port and all.

import { afterEach, describe, expect, it } from "vitest";
import {
  authOrigin,
  currentStudioUrl,
  engineRegistryUrl,
  isDocsHost,
  isLegacyHost,
  isLoopbackAddress,
  parsePorts,
  servicePorts,
  serviceUrl,
  studioFamily,
  studioOrigin,
} from "./services.ts";

describe("serviceUrl", () => {
  it("echoes k7 back on whatever origin it's given, dev or prod", () => {
    expect(serviceUrl("https://app.k7.rocks/x", "k7")).toBe(
      "https://app.k7.rocks",
    );
    expect(serviceUrl("https://app.priv.k7.rocks/x", "k7")).toBe(
      "https://app.priv.k7.rocks",
    );
  });

  it("resolves pl8 and k7 to k7's own origin, since k7 serves pl8", () => {
    expect(serviceUrl("https://app.k7.rocks", "pl8")).toBe(
      "https://app.k7.rocks",
    );
    expect(serviceUrl("https://app.k7.rocks", "k7")).toBe(
      "https://app.k7.rocks",
    );
  });

  it("reads the docs host as the app beside it", () => {
    expect(serviceUrl("https://docs.k7.rocks/x", "k7")).toBe(
      "https://app.k7.rocks",
    );
    expect(serviceUrl("https://docs.priv.k7.rocks", "pl8")).toBe(
      "https://app.priv.k7.rocks",
    );
  });

  it("reads a former host, alias or not, as the current origin", () => {
    expect(serviceUrl("https://st0.app/x", "k7")).toBe("https://app.k7.rocks");
    expect(serviceUrl("https://play.st0.app/songs/a", "pl8")).toBe(
      "https://app.k7.rocks",
    );
    expect(serviceUrl("https://k7.st0.app/session/1", "k7")).toBe(
      "https://app.k7.rocks",
    );
    expect(serviceUrl("https://k7.priv.st0.app", "pl8")).toBe(
      "https://app.priv.k7.rocks",
    );
    expect(serviceUrl("https://play.priv.st0.app", "k7")).toBe(
      "https://app.priv.k7.rocks",
    );
  });

  it("strips an alias label on a domain of its own, which needs no configuring", () => {
    expect(serviceUrl("https://play.studio.example/x", "k7")).toBe(
      "https://studio.example",
    );
  });

  it("never strips a label down to a bare TLD", () => {
    expect(serviceUrl("https://k7.rocks", "k7")).toBe("https://k7.rocks");
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(serviceUrl("not a url", "pl8")).toBe("");
  });

  it("keeps a loopback page's own origin, port and all, for every service", () => {
    expect(serviceUrl("http://127.0.0.1:8789", "k7")).toBe(
      "http://127.0.0.1:8789",
    );
    expect(serviceUrl("http://localhost:5223", "k7")).toBe(
      "http://localhost:5223",
    );
    expect(serviceUrl("http://localhost:5223", "pl8")).toBe(
      "http://localhost:5223",
    );
  });
});

describe("isLegacyHost / isDocsHost", () => {
  it("names the hosts whose pages move to k7's origin", () => {
    expect(isLegacyHost("st0.app")).toBe(true);
    expect(isLegacyHost("play.st0.app")).toBe(true);
    expect(isLegacyHost("k7.priv.st0.app")).toBe(true);
    expect(isLegacyHost("play.studio.example")).toBe(true);
    expect(isLegacyHost("app.k7.rocks")).toBe(false);
    expect(isLegacyHost("docs.k7.rocks")).toBe(false);
    expect(isLegacyHost("k7.rocks")).toBe(false);
    expect(isLegacyHost("localhost")).toBe(false);
  });

  it("names the documentation's host", () => {
    expect(isDocsHost("docs.k7.rocks")).toBe(true);
    expect(isDocsHost("docs.priv.k7.rocks")).toBe(true);
    expect(isDocsHost("app.k7.rocks")).toBe(false);
  });
});

describe("studioOrigin", () => {
  it("drops everything but the origin", () => {
    expect(studioOrigin("https://app.k7.rocks/band/winter.k7")).toBe(
      "https://app.k7.rocks",
    );
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(studioOrigin("not a url")).toBe("");
  });
});

describe("authOrigin", () => {
  it("sends the docs host and the former hosts to k7's origin", () => {
    expect(authOrigin("https://docs.k7.rocks/x")).toBe("https://app.k7.rocks");
    expect(authOrigin("https://k7.st0.app/session/1")).toBe(
      "https://app.k7.rocks",
    );
    expect(authOrigin("https://play.st0.app/library")).toBe(
      "https://app.k7.rocks",
    );
  });

  it("echoes k7's own origin and any other host back as-is", () => {
    expect(authOrigin("https://app.k7.rocks/band/winter.k7")).toBe(
      "https://app.k7.rocks",
    );
    expect(authOrigin("http://localhost:5223")).toBe("http://localhost:5223");
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(authOrigin("not a url")).toBe("");
  });
});

describe("engineRegistryUrl", () => {
  it("is k7's origin, whichever host of the family was named", () => {
    // One registry: k7 lists its engines from its own origin, so an engine heartbeats nowhere else.
    expect(engineRegistryUrl("https://app.k7.rocks")).toBe(
      "https://app.k7.rocks",
    );
    expect(engineRegistryUrl("https://app.k7.rocks/band/winter.k7")).toBe(
      "https://app.k7.rocks",
    );
    expect(engineRegistryUrl("https://docs.k7.rocks")).toBe(
      "https://app.k7.rocks",
    );
  });

  it("moves a supervisor's saved former host to the current origin", () => {
    expect(engineRegistryUrl("https://st0.app")).toBe("https://app.k7.rocks");
    expect(engineRegistryUrl("https://play.st0.app")).toBe(
      "https://app.k7.rocks",
    );
    expect(engineRegistryUrl("https://k7.st0.app")).toBe(
      "https://app.k7.rocks",
    );
  });

  it("uses k7's backend PORT on a loopback host, where services are ports", () => {
    expect(engineRegistryUrl("http://localhost:8080")).toBe(
      "http://localhost:8789",
    );
    expect(engineRegistryUrl("http://127.0.0.1:5223")).toBe(
      "http://127.0.0.1:8789",
    );
  });

  it("returns '' for anything that is not a web URL", () => {
    expect(engineRegistryUrl("not a url")).toBe("");
    expect(engineRegistryUrl("ftp://app.k7.rocks")).toBe("");
  });
});

describe("studioFamily", () => {
  it("is k7's origin for any service of a hosted family", () => {
    expect(studioFamily("https://play.st0.app/library")).toBe(
      "https://app.k7.rocks",
    );
    expect(studioFamily("https://app.k7.rocks")).toBe("https://app.k7.rocks");
  });

  it("is the bare host on loopback, where services are only ports", () => {
    expect(studioFamily("http://localhost:8080")).toBe("http://localhost");
    expect(studioFamily("http://localhost:8789")).toBe("http://localhost");
  });

  it("returns '' for a string that is not a URL", () => {
    expect(studioFamily("not a url")).toBe("");
  });
});

describe("moved loopback ports", () => {
  afterEach(() => {
    delete process.env.STUDIO_PORTS;
    delete (globalThis as Record<string, unknown>).__STUDIO_PORTS__;
  });

  it("reads a host's table from the environment, for node", () => {
    process.env.STUDIO_PORTS = "k7=18789";
    expect(engineRegistryUrl("http://127.0.0.1:5223")).toBe(
      "http://127.0.0.1:18789",
    );
  });

  it("prefers the page's global, which a preload sets", () => {
    process.env.STUDIO_PORTS = "k7=1";
    (globalThis as Record<string, unknown>).__STUDIO_PORTS__ = "k7=18789";
    expect(servicePorts().k7).toBe(18789);
  });

  it("keeps pl8 on k7's port, whatever the table says", () => {
    process.env.STUDIO_PORTS = "k7=18789,pl8=18795";
    expect(servicePorts().pl8).toBe(18789);
    expect(servicePorts().k7).toBe(18789);
  });

  it("drops what it cannot read and keeps the rest of the table", () => {
    expect(parsePorts("pl8=18795, nope=1, k7=70000, k7=18789")).toEqual({
      k7: 18789,
    });
    process.env.STUDIO_PORTS = "pl8=18787";
    expect(servicePorts().k7).toBe(8789);
  });
});

describe("isLoopbackAddress", () => {
  it("accepts 127/8, ::1 and the IPv4-mapped spelling", () => {
    for (const a of [
      "127.0.0.1",
      "127.1.2.3",
      "::1",
      "::ffff:127.0.0.1",
      "::FFFF:127.0.0.1",
    ])
      expect(isLoopbackAddress(a)).toBe(true);
  });

  // A prefix test passes the first of these: a NAME, or a longer string that merely starts with 127.
  it("refuses what only starts like one", () => {
    for (const a of [
      "127.evil.example",
      "127.0.0.1.nip.io",
      "1270.0.0.1",
      "192.168.1.4",
      "::ffff:10.0.0.2",
      "",
      undefined,
    ])
      expect(isLoopbackAddress(a)).toBe(false);
  });
});

describe("currentStudioUrl", () => {
  it("moves a relay or an origin off a former host, keeping its scheme and path", () => {
    expect(currentStudioUrl("wss://st0.app/api/sync")).toBe(
      "wss://app.k7.rocks/api/sync",
    );
    expect(currentStudioUrl("wss://priv.st0.app/api/sync")).toBe(
      "wss://app.priv.k7.rocks/api/sync",
    );
    expect(currentStudioUrl("https://st0.app")).toBe("https://app.k7.rocks");
    expect(currentStudioUrl("https://play.st0.app/api/x?y=1")).toBe(
      "https://app.k7.rocks/api/x?y=1",
    );
  });

  it("leaves every other host alone, a self-hosted one named like an alias included", () => {
    for (const url of [
      "wss://app.k7.rocks/api/sync",
      "https://k7.example.com",
      "https://play.example.com/api/sync",
      "http://127.0.0.1:8789/api/sync",
      "not a url",
    ])
      expect(currentStudioUrl(url)).toBe(url);
  });
});
