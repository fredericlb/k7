import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "./config.ts";

// The old DOMAIN-derived cases moved to auth/oidc.test.ts: nothing host-shaped is configured now.

describe("loadAppConfig", () => {
  const keys = [
    "OIDC_ISSUER",
    "OIDC_SCOPES",
    "SESSION_SECRET",
    "AUTH_ADMIN_GROUPS",
    "GRIST_API_URL",
  ];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("carries no frontend/backend URL", () => {
    // The single-origin rule: no config field may hold a host, and this fails if one returns.
    const cfg = loadAppConfig();
    expect(cfg.auth).not.toHaveProperty("redirectUri");
    expect(cfg.auth).not.toHaveProperty("cookieDomain");
    expect(cfg.auth).not.toHaveProperty("cookieSecure");
    expect(cfg.auth).not.toHaveProperty("allowedReturnOrigins");
  });

  it("asks the IdP for nothing — pl8 runs the flow now", () => {
    // This backend mounts no login, so a scope list here would be config nothing reads.
    process.env.OIDC_SCOPES = "openid, email , groups";
    expect(loadAppConfig().auth).not.toHaveProperty("scopes");
  });

  it("carries ONE session secret, used for both cookies", () => {
    // It must be `common`'s, and a second key would buy nothing — ../../docs/auth.md.
    process.env.SESSION_SECRET = "shared";
    const cfg = loadAppConfig();
    expect(cfg.auth.sessionSecret).toBe("shared");
    expect(cfg.auth).not.toHaveProperty("studioSessionSecret");
  });

  it("honours overrides and list parsing", () => {
    process.env.AUTH_ADMIN_GROUPS = "a,b";
    expect(loadAppConfig().auth.adminGroups).toEqual(["a", "b"]);
  });

  it("reads it lazily, so tests can set process.env first", () => {
    // loadEnv() is deliberately a function, not a module-level const, so this re-reads.
    expect(loadAppConfig().auth.adminGroups).toEqual([]);
    process.env.AUTH_ADMIN_GROUPS = "later";
    expect(loadAppConfig().auth.adminGroups).toEqual(["later"]);
  });

  it("passes the Grist settings through", () => {
    process.env.GRIST_API_URL = "https://grist.example.com";
    expect(loadAppConfig().grist.url).toBe("https://grist.example.com");
  });
});
