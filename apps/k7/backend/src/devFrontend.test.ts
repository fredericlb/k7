// devFrontend: the page streamed from a running Vite, this backend's own routes left alone, and a Vite that is
// not there said by name rather than hung on (docs/dev.md).

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { devFrontend } from "./devFrontend.ts";

const servers: Server[] = [];
const listen = (s: Server): Promise<string> =>
  new Promise((ok) => {
    servers.push(s);
    s.listen(0, "127.0.0.1", () =>
      ok(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
    );
  });
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A stand-in Vite answering with what it was asked, and the Host it was asked under. */
const fakeVite = () =>
  listen(
    createServer((req, res) => {
      res.setHeader("Content-Type", "text/javascript");
      res.setHeader("X-Seen-Host", req.headers.host ?? "");
      res.statusCode = req.url === "/missing" ? 404 : 200;
      res.end(`served ${req.url}`);
    }),
  );

const backend = (vite: string) => {
  const app = express();
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use(devFrontend(vite));
  return listen(createServer(app));
};

describe("devFrontend", () => {
  it("streams a page request to Vite, under Vite's own host", async () => {
    const vite = await fakeVite();
    const r = await fetch(`${await backend(vite)}/@vite/client?t=1`);
    expect(await r.text()).toBe("served /@vite/client?t=1");
    expect(r.headers.get("content-type")).toBe("text/javascript");
    expect(r.headers.get("x-seen-host")).toBe(new URL(vite).host);
  });

  it("passes Vite's status through", async () => {
    const r = await fetch(`${await backend(await fakeVite())}/missing`);
    expect(r.status).toBe(404);
  });

  it("leaves /api and /auth to this backend", async () => {
    const base = await backend(await fakeVite());
    expect(await (await fetch(`${base}/api/health`)).json()).toEqual({
      ok: true,
    });
    // No route of its own here: an Express 404, never Vite's page.
    expect(await (await fetch(`${base}/auth/me`)).text()).not.toMatch(/served/);
  });

  it("answers a 502 naming the resource when no Vite is running", async () => {
    // A port just freed: refused at once, where an arbitrary low one may be silently dropped.
    const gone = await listen(createServer());
    await new Promise((ok) => servers.pop()?.close(ok));
    const r = await fetch(`${await backend(gone)}/`);
    expect(r.status).toBe(502);
    expect(await r.text()).toMatch(/k7-frontend/);
  });
});
