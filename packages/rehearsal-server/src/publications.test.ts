import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A LOCAL instance, whose PocketBase import is bound to fail: both are read at import.
const dir = mkdtempSync(join(tmpdir(), "k7-publications-"));
process.env.K7_DATA_DIR = dir;
process.env.K7_INSTANCE = "local";
process.env.POCKETBASE_URL = "http://127.0.0.1:1";
process.env.POCKETBASE_EMAIL = "a";
process.env.POCKETBASE_PASSWORD = "b";
const { mountRehearsal } = await import("./mount.ts");
const { store } = await import("./db.ts");
const { publicationsDeviceRouter, DEVICE_ROUTE } = await import(
  "./publications.ts"
);

const servers: Server[] = [];
const listen = (
  app: express.Express,
): Promise<{ url: string; server: Server }> =>
  new Promise((ok) => {
    const server = createServer(app);
    server.listen(0, () =>
      ok({
        url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        server,
      }),
    );
    servers.push(server);
  });

const asMe: express.RequestHandler = (req, _res, next) => {
  (req as { user?: { sub: string } }).user = { sub: "me" };
  next();
};

// What reached the stub server, and how it answers.
let seen: {
  method: string;
  url: string;
  headers: Record<string, unknown>;
  body: string;
}[] = [];
let paired = true;
let stubUrl: string;
let local: string;
let rehearsal: ReturnType<typeof mountRehearsal>;

beforeAll(async () => {
  const stub = express();
  stub.use(express.text({ type: "*/*" }));
  stub.get(`${DEVICE_ROUTE}/ping`, (_req, res) => res.json({ ok: true }));
  stub.all(`${DEVICE_ROUTE}/*`, (req, res) => {
    seen.push({
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: typeof req.body === "string" ? req.body : "",
    });
    res.status(201).set("x-from", "server").json({ id: "r1" });
  });
  stubUrl = (await listen(stub)).url;

  const app = express();
  app.use(express.json());
  rehearsal = mountRehearsal(app, {
    requireAuth: asMe,
    mediatek: { base: "http://127.0.0.1:1" },
    server: () => (paired ? { base: stubUrl, token: "dev-token" } : null),
  });
  // A route of another service on the same `/api`, which the rehearsal import must never hold up.
  app.get("/api/other", (_req, res) => res.json({ ok: true }));
  const { url, server } = await listen(app);
  local = url;
  rehearsal.serve(server);
});

afterAll(async () => {
  await rehearsal.stop();
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a local instance's releases and pages", () => {
  it("forwards to the server's device door, with the token and the body", async () => {
    seen = [];
    const r = await fetch(`${local}/api/releases?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "studio.sid=s" },
      body: JSON.stringify({ title: "Song" }),
    });
    expect(r.status).toBe(201);
    expect(r.headers.get("x-from")).toBe("server");
    expect(await r.json()).toEqual({ id: "r1" });
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: `${DEVICE_ROUTE}/releases?x=1`,
      body: JSON.stringify({ title: "Song" }),
    });
    expect(seen[0].headers.authorization).toBe("Bearer dev-token");
    expect(seen[0].headers.cookie).toBeUndefined();
  });

  it("says why when there is no server, and when it does not answer", async () => {
    paired = false;
    const none = await fetch(`${local}/api/pages`);
    expect(none.status).toBe(503);
    expect(await none.json()).toMatchObject({ reason: "unpaired" });
    expect(await (await fetch(`${local}/api/publications`)).json()).toEqual({
      available: false,
      reason: "unpaired",
      server: null,
    });
    paired = true;
    const away = stubUrl;
    stubUrl = "http://127.0.0.1:1";
    expect(await (await fetch(`${local}/api/pages`)).json()).toMatchObject({
      reason: "unreachable",
    });
    stubUrl = away;
    expect(await (await fetch(`${local}/api/publications`)).json()).toEqual({
      available: true,
      server: stubUrl,
    });
  });

  it("a failed import holds the rehearsal routes, and nothing else on /api", async () => {
    // The import from a PocketBase nobody listens on has failed by now.
    await new Promise((r) => setTimeout(r, 200));
    expect((await fetch(`${local}/api/songs`)).status).toBe(503);
    expect((await fetch(`${local}/api/other`)).status).toBe(200);
  });
});

describe("the server's device door", () => {
  it("acts as the person the token names, and refuses a token that names nobody", async () => {
    const app = express();
    app.use(
      DEVICE_ROUTE,
      publicationsDeviceRouter((req, res, next) => {
        res.locals.syncCaller = {
          slug: "a",
          person: req.headers["x-person"] ?? null,
          device: "laptop",
        };
        next();
      }),
    );
    const { url } = await listen(app);
    const ping = await fetch(`${url}${DEVICE_ROUTE}/ping`, {
      headers: { "x-person": "p1" },
    });
    expect(ping.status).toBe(200);
    const nobody = await fetch(`${url}${DEVICE_ROUTE}/ping`);
    expect(nobody.status).toBe(403);
    expect(await nobody.json()).toMatchObject({ reason: "repair" });
  });
});
