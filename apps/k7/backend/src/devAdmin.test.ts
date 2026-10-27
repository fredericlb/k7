// The dev stub is an admin in a local dev session, and only there: a configured OIDC, or the
// tray's local user (same subject, no STUDIO_DEV_AUTH), must never see it promoted.

import type { Request, RequestHandler, Response } from "express";
import { describe, expect, it } from "vitest";
import { DEV_SUB, withDevAdmin } from "./devAdmin.ts";

/** A requireAuth that signs `user` in, as the commons one does once the session reads. */
const signsIn =
  (user: Record<string, unknown>): RequestHandler =>
  (req, _res, next) => {
    (req as { user?: unknown }).user = user;
    next();
  };

/** The groups the request carries once the guard has run. */
function groupsAfter(guard: RequestHandler): string[] | undefined {
  const req = {} as Request;
  guard(req, {} as Response, () => {});
  return (req.user as { groups?: string[] } | undefined)?.groups;
}

const DEV = { STUDIO_DEV_AUTH: "1", AUTH_ADMIN_GROUPS: "admins, staff" };

describe("withDevAdmin", () => {
  it("gives the dev stub every admin group in a dev session", () => {
    const g = withDevAdmin(signsIn({ sub: DEV_SUB, groups: [] }), DEV);
    expect(groupsAfter(g)).toEqual(["admins", "staff"]);
  });

  it("leaves a real account as it signed in", () => {
    const g = withDevAdmin(signsIn({ sub: "alice", groups: ["band"] }), DEV);
    expect(groupsAfter(g)).toEqual(["band"]);
  });

  it("is off under a configured OIDC, whatever the flag says", () => {
    const g = withDevAdmin(signsIn({ sub: DEV_SUB, groups: [] }), {
      ...DEV,
      OIDC_ISSUER: "https://login.example",
      OIDC_CLIENT_ID: "k7",
    });
    expect(groupsAfter(g)).toEqual([]);
  });

  it("is off for the tray's local user, which runs without STUDIO_DEV_AUTH", () => {
    const g = withDevAdmin(signsIn({ sub: DEV_SUB, groups: [] }), {
      STUDIO_LOCAL_USER: "1",
      AUTH_ADMIN_GROUPS: "admins",
    });
    expect(groupsAfter(g)).toEqual([]);
  });

  it("admits nobody when no admin group is configured", () => {
    const g = withDevAdmin(signsIn({ sub: DEV_SUB, groups: [] }), {
      STUDIO_DEV_AUTH: "1",
    });
    expect(groupsAfter(g)).toEqual([]);
  });
});
