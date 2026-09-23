// st0 and z0 stay path-resolved on the SAME origin they're given; pl8 and k7 resolve to
// their OWN hostname, picking dev vs prod by whichever family that origin belongs to.

import { describe, expect, it } from "vitest";
import {
  authOrigin,
  engineRegistryUrl,
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

  it("resolves pl8/k7 to their own prod host from a prod origin", () => {
    expect(serviceUrl("https://st0.app", "pl8")).toBe("https://play.st0.app");
    expect(serviceUrl("https://st0.app", "k7")).toBe("https://k7.st0.app");
  });

  it("resolves pl8/k7 to their own dev host from a dev origin", () => {
    expect(serviceUrl("https://priv.st0.app", "pl8")).toBe(
      "https://play.priv.st0.app",
    );
    expect(serviceUrl("https://k7.priv.st0.app", "k7")).toBe(
      "https://k7.priv.st0.app",
    );
  });

  it("picks the dev family from ANY of the three dev hosts, not just st0's", () => {
    expect(serviceUrl("https://play.priv.st0.app", "k7")).toBe(
      "https://k7.priv.st0.app",
    );
  });

  it("returns '' for a string that is not a URL, never a throw", () => {
    expect(serviceUrl("not a url", "pl8")).toBe("");
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
  it("sends k7's/pl8's own subdomain back to the family root", () => {
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
  it("is pl8's, whichever service of the family was named", () => {
    // One registry: st0 lists its engines from pl8, so an engine heartbeats nowhere else.
    expect(engineRegistryUrl("https://st0.app")).toBe("https://play.st0.app");
    expect(engineRegistryUrl("https://st0.app/band/winter.st0")).toBe(
      "https://play.st0.app",
    );
    expect(engineRegistryUrl("https://play.st0.app")).toBe(
      "https://play.st0.app",
    );
    expect(engineRegistryUrl("https://k7.st0.app")).toBe(
      "https://play.st0.app",
    );
  });

  it("uses pl8's dev PORT on a loopback host, where services are ports", () => {
    expect(engineRegistryUrl("http://localhost:8789")).toBe(
      "http://localhost:8795",
    );
    expect(engineRegistryUrl("http://127.0.0.1:5223")).toBe(
      "http://127.0.0.1:8795",
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
    expect(studioFamily("http://localhost:8795")).toBe("http://localhost");
    expect(studioFamily("http://localhost:8789")).toBe("http://localhost");
  });

  it("returns '' for a string that is not a URL", () => {
    expect(studioFamily("not a url")).toBe("");
  });
});
