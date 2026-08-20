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

// ONE secret, `common`'s: it signs the guest cookie here and verifies the one
// pl8 signed. Two cookies, one key — see the "renamed" case below for why that
// is safe.
const SECRET = "the-shared-studio-secret";

beforeAll(() => {
  initSessionAuth({ sessionSecret: SECRET, adminGroups: ["admins"] });
});

// currentUser() reads req.headers.cookie for the account and req.session for
// the guest — cookie-session having already decoded the latter upstream.
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
    // pl8 has to request the `groups` scope for this to be non-empty — see its
    // server.ts. Without it every admin surface 403s with nothing to look at.
    const u = studioUser(studioCookie({ sub: "a", groups: ["admins"] }));
    expect(isAdmin(u)).toBe(true);
  });

  it("refuses a session signed with the wrong key", () => {
    // The realistic misconfiguration: this service given a SESSION_SECRET of
    // its own instead of `common`'s. Nothing errors — the cookie simply never
    // verifies, and the login appears to loop. docs/auth.md.
    expect(studioUser(studioCookie({ sub: "a" }, "not-the-key"))).toBe(null);
  });

  it("is null when there is no cookie at all", () => {
    expect(studioUser(undefined)).toBe(null);
  });
});

describe("one secret is enough for two cookies", () => {
  // This is why z0 does NOT need a second key, and why it must instead use
  // `common`'s like st0 and m9 do. A guest holds a cookie this backend signed
  // with that very key — but cookie-session signs `<name>=<value>`, so the
  // cookie's NAME is inside the signature. Renaming it to studio.sid leaves a
  // signature computed over `bt_session=…`, which no longer verifies.
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
    // Load-bearing order: /auth/logout can only expire bt_session, so a guest
    // shadowing an account would be unloggable-out from z0.
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
    // req.session is cookie-session's job; a raw bt_session header alone is
    // not a principal here, and must not become one via the studio path.
    const raw = sessionCookieHeader(
      { kind: "user", sub: "nope" },
      { cookieName: SESSION_COOKIE_NAME, secret: SECRET },
    );
    expect(currentUser(req({ cookie: raw }))).toBe(null);
  });
});
