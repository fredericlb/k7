import { afterEach, describe, expect, it } from "vitest";
import { loadAppConfig } from "./config.ts";

// What this file used to assert — that redirectUri, cookieDomain, cookieSecure
// and allowedReturnOrigins are all derived from a DOMAIN var — is gone on
// purpose. The app is single-origin, so nothing host-shaped is configured any
// more; it's derived per request instead. Those cases now live in
// auth/oidc.test.ts (publicOrigin / redirectUriFor / safeReturnTarget).

describe("loadAppConfig", () => {
  const keys = [
    "OIDC_ISSUER",
    "OIDC_SCOPES",
    "AUTH_ADMIN_GROUPS",
    "GRIST_API_URL",
  ];
  afterEach(() => {
    for (const k of keys) delete process.env[k];
  });

  it("carries no frontend/backend URL", () => {
    // The single-origin rule: no config field may hold a host or origin. If a
    // future change reintroduces one, this fails.
    const cfg = loadAppConfig();
    expect(cfg.auth).not.toHaveProperty("redirectUri");
    expect(cfg.auth).not.toHaveProperty("cookieDomain");
    expect(cfg.auth).not.toHaveProperty("cookieSecure");
    expect(cfg.auth).not.toHaveProperty("allowedReturnOrigins");
  });

  it("applies the scope defaults", () => {
    expect(loadAppConfig().auth.scopes).toEqual(["openid", "profile", "email"]);
  });

  it("honours overrides and list parsing", () => {
    process.env.OIDC_SCOPES = "openid, email , groups";
    process.env.AUTH_ADMIN_GROUPS = "a,b";
    const cfg = loadAppConfig();
    expect(cfg.auth.scopes).toEqual(["openid", "email", "groups"]);
    expect(cfg.auth.adminGroups).toEqual(["a", "b"]);
  });

  it("reads it lazily, so tests can set process.env first", () => {
    // loadAppConfig() re-reads on every call — loadEnv() is deliberately a
    // function, not a module-level const.
    expect(loadAppConfig().auth.adminGroups).toEqual([]);
    process.env.AUTH_ADMIN_GROUPS = "later";
    expect(loadAppConfig().auth.adminGroups).toEqual(["later"]);
  });

  it("passes the Grist settings through", () => {
    process.env.GRIST_API_URL = "https://grist.example.com";
    expect(loadAppConfig().grist.url).toBe("https://grist.example.com");
  });
});
