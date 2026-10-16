import { describe, expect, it, vi } from "vitest";
import {
  isAllowedOrigin,
  isCrossSiteWrite,
  type OriginPolicy,
  originPolicyFromEnv,
  studioCors,
} from "./cors.ts";

const HOSTED: OriginPolicy = {
  cookieDomain: ".st0.app",
  trusted: ["https://partner.example"],
  loopback: false,
};
const LOCAL: OriginPolicy = { cookieDomain: "", trusted: [], loopback: true };

describe("isAllowedOrigin", () => {
  it("allows the request's own host", () => {
    expect(isAllowedOrigin("https://st0.app", "st0.app", HOSTED)).toBe(true);
    expect(
      isAllowedOrigin("https://elsewhere.example", "elsewhere.example", HOSTED),
    ).toBe(true);
  });

  it("allows the cookie's domain and its subdomains, over https only", () => {
    expect(isAllowedOrigin("https://st0.app", "x", HOSTED)).toBe(true);
    expect(isAllowedOrigin("https://play.st0.app", "x", HOSTED)).toBe(true);
    expect(isAllowedOrigin("http://play.st0.app", "x", HOSTED)).toBe(false);
    expect(isAllowedOrigin("https://evilst0.app", "x", HOSTED)).toBe(false);
    expect(isAllowedOrigin("https://st0.app.evil.example", "x", HOSTED)).toBe(
      false,
    );
  });

  it("allows TRUSTED_ORIGINS exactly", () => {
    expect(isAllowedOrigin("https://partner.example", "x", HOSTED)).toBe(true);
    expect(isAllowedOrigin("http://partner.example", "x", HOSTED)).toBe(false);
    expect(isAllowedOrigin("https://a.partner.example", "x", HOSTED)).toBe(
      false,
    );
  });

  it("refuses any other origin, null and garbage included", () => {
    expect(isAllowedOrigin("https://evil.example", "st0.app", HOSTED)).toBe(
      false,
    );
    expect(isAllowedOrigin("null", "st0.app", HOSTED)).toBe(false);
    expect(isAllowedOrigin("not a url", "st0.app", HOSTED)).toBe(false);
  });

  it("allows loopback pages only where the policy says so", () => {
    expect(isAllowedOrigin("http://127.0.0.1:5173", "x", LOCAL)).toBe(true);
    expect(isAllowedOrigin("http://localhost:5223", "x", LOCAL)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:5223", "x", LOCAL)).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173", "x", HOSTED)).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.4:5173", "x", LOCAL)).toBe(false);
  });
});

describe("originPolicyFromEnv", () => {
  it("reads the cookie domain and the trusted list, and keeps loopback off a hosted origin", () => {
    const p = originPolicyFromEnv({
      COOKIE_DOMAIN: ".st0.app",
      TRUSTED_ORIGINS: " https://a.example , ,https://b.example",
    });
    expect(p).toEqual({
      cookieDomain: ".st0.app",
      trusted: ["https://a.example", "https://b.example"],
      loopback: false,
    });
  });

  it("allows loopback with no cookie domain, or for the local user", () => {
    expect(originPolicyFromEnv({}).loopback).toBe(true);
    expect(
      originPolicyFromEnv({ COOKIE_DOMAIN: ".x.app", STUDIO_LOCAL_USER: "1" })
        .loopback,
    ).toBe(true);
  });
});

describe("isCrossSiteWrite", () => {
  it("never refuses a safe method", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"])
      expect(
        isCrossSiteWrite(m, "https://evil.example", "cross-site", false),
      ).toBe(false);
  });

  it("refuses a write from an origin not allowed, and lets an allowed one through", () => {
    expect(
      isCrossSiteWrite("POST", "https://evil.example", undefined, false),
    ).toBe(true);
    expect(
      isCrossSiteWrite("DELETE", "https://st0.app", "same-site", true),
    ).toBe(false);
  });

  it("with no Origin, refuses only what the browser calls cross-site", () => {
    expect(isCrossSiteWrite("POST", undefined, "cross-site", false)).toBe(true);
    expect(isCrossSiteWrite("POST", undefined, "same-origin", false)).toBe(
      false,
    );
    expect(isCrossSiteWrite("POST", undefined, undefined, false)).toBe(false);
  });
});

/** Just enough of Request/Response for the middleware to touch. */
function exchange(
  policy: OriginPolicy,
  init: {
    origin?: string;
    method?: string;
    host?: string;
    forwarded?: string;
    site?: string;
  },
) {
  const out: Record<string, string> = {};
  const reqHeaders: Record<string, string | undefined> = {
    origin: init.origin,
    host: init.host ?? "st0.app",
    "x-forwarded-host": init.forwarded,
    "sec-fetch-site": init.site,
  };
  const req = {
    headers: reqHeaders,
    method: init.method ?? "GET",
    get: (k: string) => reqHeaders[k.toLowerCase()],
  } as never;
  let status: number | undefined;
  let ended = false;
  const res = {
    setHeader: (k: string, v: string) => {
      out[k] = v;
    },
    status: (s: number) => {
      status = s;
      return res;
    },
    end: () => {
      ended = true;
    },
    json: () => {
      ended = true;
    },
  } as never;
  const next = vi.fn();
  studioCors(policy)(req, res, next);
  return { headers: out, status: status as number | undefined, ended, next };
}

describe("studioCors", () => {
  it("reflects an allowed origin with credentials, never a wildcard", () => {
    const { headers } = exchange(HOSTED, { origin: "https://k7.st0.app" });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://k7.st0.app");
    expect(headers.Vary).toBe("Origin");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("gives an unknown origin no CORS answer at all", () => {
    const { headers, next } = exchange(HOSTED, {
      origin: "https://evil.example",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("answers a preflight itself, without calling next", () => {
    const { status, ended, next } = exchange(HOSTED, {
      origin: "https://k7.st0.app",
      method: "OPTIONS",
    });
    expect(status).toBe(204);
    expect(ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a cross-site write with 403", () => {
    const { status, next } = exchange(HOSTED, {
      origin: "https://evil.example",
      method: "POST",
    });
    expect(status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets a native client, with neither header, write", () => {
    const { headers, next } = exchange(HOSTED, { method: "POST" });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it("reads the forwarded host as the request's own", () => {
    const { headers } = exchange(
      { cookieDomain: "", trusted: [], loopback: false },
      {
        origin: "https://priv.example",
        host: "localhost:8789",
        forwarded: "priv.example",
      },
    );
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://priv.example");
  });

  it("allows the headers the file hub's calls carry, and not the hub secret", () => {
    const { headers } = exchange(HOSTED, {
      origin: "https://play.st0.app",
      method: "OPTIONS",
    });
    const allowed = headers["Access-Control-Allow-Headers"].toLowerCase();
    for (const h of [
      "x-studio-user",
      "x-studio-workspace",
      "x-studio-engine-token",
      "x-studio-engine-id",
    ])
      expect(allowed).toContain(h);
    expect(allowed).not.toContain("x-studio-hub-secret");
  });
});
