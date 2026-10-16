// The library's token routes: minted by POST only, listed and revoked by their owner.

import { createServer, type Server } from "node:http";
import { apiTokenAuth, memoryTokenStore } from "@frediverse/oidc/api-auth";
import express, { type RequestHandler } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountTokenRoutes } from "./tokenRoutes.ts";

const tokens = apiTokenAuth("test-secret", { store: memoryTokenStore() });
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // The session stands in as a header: whoever it names is signed in.
  const requireAuth: RequestHandler = (req, res, next) => {
    const who = req.get("x-test-user");
    if (!who) return void res.status(401).json({ error: "unauthenticated" });
    (req as { user?: unknown }).user = { sub: who };
    next();
  };
  mountTokenRoutes(app, requireAuth, tokens);
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
});

const as = (user: string, init: RequestInit = {}) => ({
  ...init,
  headers: {
    "x-test-user": user,
    "Content-Type": "application/json",
    ...init.headers,
  },
});

describe("token routes", () => {
  it("never mints on a GET: it lists", async () => {
    const res = await fetch(`${base}/api/token`, as("ada"));
    expect(await res.json()).toEqual({ tokens: [] });
  });

  it("mints by POST, lists, and revokes only the owner's", async () => {
    const minted = (await (
      await fetch(
        `${base}/api/token`,
        as("ada", { method: "POST", body: '{"label":"laptop"}' }),
      )
    ).json()) as { token: string; id: string; label: string };
    expect(tokens.verifyApiToken(minted.token)).toBe("ada");
    expect(minted.label).toBe("laptop");
    const del = (user: string) =>
      fetch(`${base}/api/token/${minted.id}`, as(user, { method: "DELETE" }));
    expect((await del("bob")).status).toBe(404);
    expect((await del("ada")).status).toBe(200);
    expect(tokens.verifyApiToken(minted.token)).toBeNull();
  });

  it("pairs only towards a loopback address", async () => {
    const bad = await fetch(
      `${base}/api/token/pair?return=${encodeURIComponent("https://evil.example/")}`,
      as("ada", { redirect: "manual" }),
    );
    expect(bad.status).toBe(400);
    const ok = await fetch(
      `${base}/api/token/pair?return=${encodeURIComponent("http://127.0.0.1:9/p")}`,
      as("ada", { redirect: "manual" }),
    );
    const to = new URL(ok.headers.get("location") ?? "");
    expect(tokens.verifyApiToken(to.searchParams.get("token") ?? "")).toBe(
      "ada",
    );
  });
});
