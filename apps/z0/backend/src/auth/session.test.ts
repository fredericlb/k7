// Two cookies reach this backend and only one is ours to write. These lock the
// three things that make that safe: the account is read off studio.sid, the
// guest cookie still works, and neither key can be used for the other cookie.
// Rationale in apps/z0/docs/auth.md.

import { sessionCookieHeader } from "@frediverse/oidc";
import type { Request } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import {
  currentUser,
  initSessionAuth,
  isAdmin,
  SESSION_COOKIE_NAME,
  STUDIO_COOKIE_NAME,
  studioUser,
} from "./session.ts";

// ONE secret, `common`'s: it signs the guest cookie here and verifies the one pl8 signed.
const SECRET = "the-shared-studio-secret";

beforeAll(() => {
  initSessionAuth({ sessionSecret: SECRET, adminGroups: ["admins"] });
});

// The account comes off req.headers.cookie, the guest off the req.session cookie-session decoded.
const req = (opts: { cookie?: string; session?: unknown }): Request =>
  ({
    headers: opts.cookie ? { cookie: opts.cookie } : {},
    session: opts.session,
  }) as unknown as Request;

const studioCookie = (user: Record<string, unknown>, secret = SECRET) =>
  sessionCookieHeader(user, { cookieName: STUDIO_COOKIE_NAME, secret });

describe("studioUser", () => {
  it("reads pl8's session and tags it as an account", () => {
    const u = studioUser(studioCookie({ sub: "abc", name: "Fred" }));
    expect(u).toMatchObject({ sub: "abc", name: "Fred", kind: "user" });
  });

  it("carries the groups through, which is what the admin gate reads", () => {
    // pl8 must request the `groups` scope, or every admin surface 403s — ../../../docs/auth.md.
    const u = studioUser(studioCookie({ sub: "a", groups: ["admins"] }));
    expect(isAdmin(u)).toBe(true);
  });

  it("refuses a session signed with the wrong key", () => {
    // A key of its own instead of `common`'s errors nowhere and loops — ../../../docs/auth.md.
    expect(studioUser(studioCookie({ sub: "a" }, "not-the-key"))).toBe(null);
  });

  it("is null when there is no cookie at all", () => {
    expect(studioUser(undefined)).toBe(null);
  });
});

describe("one secret is enough for two cookies", () => {
  // cookie-session signs `<name>=<value>`, so the NAME is inside the signature.
  it("rejects a guest cookie renamed studio.sid, same key and all", () => {
    const issued = sessionCookieHeader(
      { kind: "guest", name: "mallory" },
      { cookieName: SESSION_COOKIE_NAME, secret: SECRET },
    );
    const renamed = issued.replaceAll(SESSION_COOKIE_NAME, STUDIO_COOKIE_NAME);
    expect(studioUser(renamed)).toBe(null);
  });
});

describe("currentUser", () => {
  it("prefers the account over a guest cookie left over beside it", () => {
    // Load-bearing order: /auth/logout expires bt_session only, so a shadowing guest would stick.
    const u = currentUser(
      req({
        cookie: studioCookie({ sub: "abc" }),
        session: { user: { kind: "guest", name: "old" } },
      }),
    );
    expect(u).toMatchObject({ sub: "abc", kind: "user" });
  });

  it("still lets a guest in — they have no studio account by design", () => {
    const u = currentUser(
      req({ session: { user: { kind: "guest", name: "z" } } }),
    );
    expect(u).toMatchObject({ kind: "guest", name: "z" });
  });

  it("is null for a visitor holding neither", () => {
    expect(currentUser(req({}))).toBe(null);
  });

  it("ignores a bt_session cookie the middleware did not decode", () => {
    // A raw bt_session header is not a principal, and must not become one by the studio path.
    const raw = sessionCookieHeader(
      { kind: "user", sub: "nope" },
      { cookieName: SESSION_COOKIE_NAME, secret: SECRET },
    );
    expect(currentUser(req({ cookie: raw }))).toBe(null);
  });
});
