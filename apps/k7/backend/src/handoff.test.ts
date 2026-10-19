import { createServer, type Server } from "node:http";
import { sessionCookieHeader, setupAuth } from "@frediverse/oidc";
import {
  HANDOFF_ISSUE,
  HANDOFF_REDEEM,
  isHandoffReturn,
} from "@studio/web-protocol/handoff";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { challengeOf, mountHandoff, openCode, signCode } from "./handoff.ts";

const KEY = "k";
const user = { sub: "u1", name: "Ana", email: "ana@example.com", groups: [] };
const verifier = "the-app-keeps-this";
const fresh = () =>
  signCode(KEY, { u: user, c: challengeOf(verifier), e: Date.now() + 60_000 });

describe("handoff code", () => {
  it("opens with its verifier", () => {
    expect(openCode(KEY, fresh(), verifier)?.user).toEqual(user);
  });

  it("is useless without the verifier", () => {
    expect(openCode(KEY, fresh(), "guessed")).toBeNull();
  });

  it("refuses another key, a tampered body and an expired code", () => {
    expect(openCode("other", fresh(), verifier)).toBeNull();
    const [, sig] = fresh().split(".");
    const forged = Buffer.from(
      JSON.stringify({
        u: { sub: "admin" },
        c: challengeOf(verifier),
        e: Date.now() + 60_000,
      }),
    ).toString("base64url");
    expect(openCode(KEY, `${forged}.${sig}`, verifier)).toBeNull();
    expect(openCode(KEY, fresh(), verifier, Date.now() + 120_000)).toBeNull();
  });
});

describe("isHandoffReturn", () => {
  it("allows loopback http and the app's scheme only", () => {
    expect(isHandoffReturn("http://127.0.0.1:5123/done")).toBe(true);
    expect(isHandoffReturn("se.frediver.k7://auth")).toBe(true);
    // The e2e build installs beside the shipped app, under its own scheme, so the answer reaches IT.
    expect(isHandoffReturn("se.frediver.k7.e2e://auth")).toBe(true);
    expect(isHandoffReturn("se.frediver.k7.evil://auth")).toBe(false);
    expect(isHandoffReturn("https://evil.example/x")).toBe(false);
    expect(isHandoffReturn("http://192.168.1.2/done")).toBe(false);
    expect(isHandoffReturn("javascript:alert(1)")).toBe(false);
  });
});

// The routes against a real session middleware, in setupAuth's dev mode.
describe("handoff routes", () => {
  const SECRET = "handoff-test-secret";
  const NAME = "studio.sid";
  const redirect = "http://127.0.0.1:5123/done";
  let server: Server;
  let base: string;

  beforeAll(async () => {
    process.env.SESSION_SECRET = SECRET;
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    const app = express();
    const auth = await setupAuth(app, {
      cookieName: NAME,
      service: "handoff-test",
      cookieDomain: "",
      trustedOrigins: [],
    });
    mountHandoff(app, { secret: SECRET, localUser: false, auth });
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterAll(() => {
    server.close();
  });

  const cookieOf = (sub: string) =>
    sessionCookieHeader(
      { sub, name: sub, email: `${sub}@example.com`, groups: [] },
      { cookieName: NAME, secret: SECRET },
    );

  const issue = async (sub: string, origin = base) => {
    const body = new URLSearchParams({
      redirect,
      challenge: challengeOf(verifier),
      state: "s",
    });
    return fetch(`${base}${HANDOFF_ISSUE}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookieOf(sub),
        Origin: origin,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  };

  const codeFor = async (sub: string) => {
    const res = await issue(sub);
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location") ?? "");
    return to.searchParams.get("code") ?? "";
  };

  const redeem = (code: string, headers: Record<string, string> = {}) => {
    const u = new URL(`${base}${HANDOFF_REDEEM}`);
    u.searchParams.set("code", code);
    u.searchParams.set("verifier", verifier);
    return fetch(u, {
      redirect: "manual",
      headers: { "Sec-Fetch-Site": "none", ...headers },
    });
  };

  it("asks before issuing: the GET is a confirmation page, with no code", async () => {
    const u = new URL(`${base}${HANDOFF_ISSUE}`);
    u.searchParams.set("redirect", redirect);
    u.searchParams.set("challenge", challengeOf(verifier));
    const res = await fetch(u, {
      redirect: "manual",
      headers: { Cookie: cookieOf("ana") },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Sign in k7 on this device?");
    expect(html).not.toContain("code=");
  });

  it("refuses a cross-site confirmation", async () => {
    expect((await issue("ana", "https://evil.example")).status).toBe(403);
  });

  it("redeems a code once, and only from the app's own navigation", async () => {
    const code = await codeFor("ana");
    expect(
      (await redeem(code, { "Sec-Fetch-Site": "cross-site" })).status,
    ).toBe(403);
    const first = await redeem(code);
    expect(first.status).toBe(302);
    expect(first.headers.get("set-cookie")).toContain(`${NAME}=`);
    expect((await redeem(code)).status).toBe(401);
  });

  it("never replaces another account's session", async () => {
    const code = await codeFor("mallory");
    const res = await redeem(code, { Cookie: cookieOf("ana") });
    expect(res.status).toBe(409);
  });

  it("signs the same account in again", async () => {
    const code = await codeFor("ana");
    expect((await redeem(code, { Cookie: cookieOf("ana") })).status).toBe(302);
  });
});
