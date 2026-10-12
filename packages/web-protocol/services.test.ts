// Every service resolves on the family root's origin, the `play.` and `k7.` aliases stripped,
// z0 a path under it; on a loopback host that origin is the page's own, port and all.

import { afterEach, describe, expect, it } from "vitest";
import {
  authOrigin,
  engineRegistryUrl,
  parsePorts,
  servicePorts,
  serviceUrl,
  studioFamily,
  studioOrigin,
} from "./services.ts";

describe("serviceUrl", () => {
  it("echoes st0 back on whatever origin it's given, dev or prod", () => {
    expect(serviceUrl("https://st0.app/x", "st0")).toBe("https://st0.app");
    expect(serviceUrl("https://priv.st0.app/x", "st0")).toBe(
      "https://priv.st0.app",
    );
  });

  it("keeps z0 a path under the given origin, unmoved", () => {
    expect(serviceUrl("https://st0.app", "z0")).toBe("https://st0.app/z0");
    expect(serviceUrl("https://priv.st0.app", "z0")).toBe(
      "https://priv.st0.app/z0",
    );
  });

  it("resolves pl8 and k7 to st0's own origin, since st0 serves both", () => {
    expect(serviceUrl("https://st0.app", "pl8")).toBe("https://st0.app");
    expect(serviceUrl("https://st0.app", "k7")).toBe("https://st0.app");
  });

  it("strips the play. alias back to the family root, for any service", () => {
    expect(serviceUrl("https://play.st0.app/songs/a", "pl8")).toBe(
      "https://st0.app",
    );
    expect(serviceUrl("https://play.priv.st0.app", "st0")).toBe(
      "https://priv.st0.app",
    );
  });

  it("strips the k7. alias back to the family root, for any service", () => {
    expect(serviceUrl("https://k7.priv.st0.app", "k7")).toBe(
      "https://priv.st0.app",
    );
    expect(serviceUrl("https://k7.st0.app/session/1", "st0")).toBe(
      "https://st0.app",
    );
    expect(serviceUrl("https://k7.priv.st0.app", "z0")).toBe(
      "https://priv.st0.app/z0",
    );
  });

  it("picks the dev family from ANY of the dev hosts, not just st0's", () => {
    expect(serviceUrl("https://play.priv.st0.app", "k7")).toBe(
      "https://priv.st0.app",
    );
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(serviceUrl("not a url", "pl8")).toBe("");
  });

  it("keeps a loopback page's own origin, port and all, for every service", () => {
    expect(serviceUrl("http://127.0.0.1:8789", "k7")).toBe(
      "http://127.0.0.1:8789",
    );
    expect(serviceUrl("http://localhost:5223", "st0")).toBe(
      "http://localhost:5223",
    );
    expect(serviceUrl("http://localhost:5223", "pl8")).toBe(
      "http://localhost:5223",
    );
    expect(serviceUrl("http://127.0.0.1:5223", "z0")).toBe(
      "http://127.0.0.1:5223/z0",
    );
  });
});

describe("studioOrigin", () => {
  it("drops everything but the origin", () => {
    expect(studioOrigin("https://st0.app/band/winter.st0")).toBe(
      "https://st0.app",
    );
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(studioOrigin("not a url")).toBe("");
  });
});

describe("authOrigin", () => {
  it("sends the k7. and play. aliases back to the family root", () => {
    expect(authOrigin("https://k7.st0.app/session/1")).toBe("https://st0.app");
    expect(authOrigin("https://play.st0.app/library")).toBe("https://st0.app");
  });

  it("echoes st0's own origin and any other host back as-is", () => {
    expect(authOrigin("https://st0.app/band/winter.st0")).toBe(
      "https://st0.app",
    );
    expect(authOrigin("http://localhost:5223")).toBe("http://localhost:5223");
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(authOrigin("not a url")).toBe("");
  });
});

describe("engineRegistryUrl", () => {
  it("is the family root, whichever service of the family was named", () => {
    // One registry: st0 lists its engines from its own origin, so an engine heartbeats nowhere else.
    expect(engineRegistryUrl("https://st0.app")).toBe("https://st0.app");
    expect(engineRegistryUrl("https://st0.app/band/winter.st0")).toBe(
      "https://st0.app",
    );
    expect(engineRegistryUrl("https://play.st0.app")).toBe("https://st0.app");
    expect(engineRegistryUrl("https://k7.st0.app")).toBe("https://st0.app");
  });

  it("uses st0's backend PORT on a loopback host, where services are ports", () => {
    expect(engineRegistryUrl("http://localhost:8080")).toBe(
      "http://localhost:8789",
    );
    expect(engineRegistryUrl("http://127.0.0.1:5223")).toBe(
      "http://127.0.0.1:8789",
    );
  });

  it("returns '' for anything that is not a web URL", () => {
    expect(engineRegistryUrl("not a url")).toBe("");
    expect(engineRegistryUrl("ftp://st0.app")).toBe("");
  });
});

describe("studioFamily", () => {
  it("is st0's origin for any service of a hosted family", () => {
    expect(studioFamily("https://play.st0.app/library")).toBe(
      "https://st0.app",
    );
    expect(studioFamily("https://st0.app")).toBe("https://st0.app");
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
    process.env.STUDIO_PORTS = "st0=18789";
    expect(engineRegistryUrl("http://127.0.0.1:5223")).toBe(
      "http://127.0.0.1:18789",
    );
  });

  it("prefers the page's global, which a preload sets", () => {
    process.env.STUDIO_PORTS = "st0=1";
    (globalThis as Record<string, unknown>).__STUDIO_PORTS__ = "st0=18789";
    expect(servicePorts().st0).toBe(18789);
  });

  it("keeps pl8 and k7 on st0's port, whatever the table says", () => {
    process.env.STUDIO_PORTS = "st0=18789,pl8=18795,k7=18787";
    expect(servicePorts().pl8).toBe(18789);
    expect(servicePorts().k7).toBe(18789);
  });

  it("drops what it cannot read and keeps the rest of the table", () => {
    expect(
      parsePorts("pl8=18795, nope=1, k7=18787, z0=70000, st0=18789"),
    ).toEqual({
      st0: 18789,
    });
    process.env.STUDIO_PORTS = "k7=18787";
    expect(servicePorts().st0).toBe(8789);
  });
});
