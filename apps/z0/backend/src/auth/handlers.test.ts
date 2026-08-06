// The anti-loop signal on /auth/me. A 401 that means "sign in" and a 401 that
// means "you cannot sign in here" look identical to a browser, and the second
// one turns the login button into a round trip that changes nothing. This locks
// the flag that tells them apart. See apps/z0/docs/auth.md.

import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { handleAuthMe } from "./handlers.ts";
import { initSessionAuth } from "./session.ts";

// Enough of a Response to record what the handler decided.
function capture() {
  const out: { status: number; body: Record<string, unknown> } = {
    status: 200,
    body: {},
  };
  const res = {
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return this;
    },
  } as unknown as Response;
  return { res, out };
}

const anonymous = { headers: {}, session: undefined } as unknown as Request;

describe("GET /auth/me, unauthenticated", () => {
  it("says accounts are possible when the studio secret is there", () => {
    initSessionAuth({
      sessionSecret: "guests",
      studioSessionSecret: "account",
      adminGroups: [],
    });
    const { res, out } = capture();
    handleAuthMe(anonymous, res);
    expect(out.status).toBe(401);
    expect(out.body.accountsConfigured).toBe(true);
  });

  it("says they are NOT when it is missing — the loop the flag prevents", () => {
    initSessionAuth({
      sessionSecret: "guests",
      studioSessionSecret: "",
      adminGroups: [],
    });
    const { res, out } = capture();
    handleAuthMe(anonymous, res);
    expect(out.status).toBe(401);
    expect(out.body.accountsConfigured).toBe(false);
  });
});
