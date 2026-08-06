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
    "SESSION_SECRET",
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

  it("asks the IdP for nothing — st0 runs the flow now", () => {
    // `scopes` used to live here and be handed to setupAuth. This backend
    // mounts no login, so a scope list here would be config nothing reads.
    process.env.OIDC_SCOPES = "openid, email , groups";
    expect(loadAppConfig().auth).not.toHaveProperty("scopes");
  });

  it("carries ONE session secret, used for both cookies", () => {
    // It signs bt_session and verifies st0's studio.sid. A second key would buy
    // nothing — the cookie's name is inside the signature, see
    // auth/session.test.ts — and this one must be `common`'s or the account
    // login silently stops working.
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
