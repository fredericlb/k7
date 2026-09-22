// st0 and z0 stay path-resolved on the SAME origin they're given; pl8 and k7 resolve to
// their OWN hostname, picking dev vs prod by whichever family that origin belongs to.

import { describe, expect, it } from "vitest";
import { authOrigin, serviceUrl, studioOrigin } from "./services.ts";

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
