// The shared JSON parser runs before any guard, so its limits are what a stranger can make
// this process parse; each route that needs another one is checked here. See ../docs/hardening.md.

import type { Server } from "node:http";
import { FILE_HUB_PATH } from "@studio/file-hub";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiOrganizeBody } from "./aiOrganize";
import { jsonBodies } from "./bodyLimits.ts";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  // Mounted as server.ts mounts them: the AI route's own parser first, then the shared one.
  app.use("/api/ai", aiOrganizeBody);
  app.use(jsonBodies());
  // Every route answers whether the body was parsed, and how much of it there was.
  app.use((req, res) =>
    res.json({
      parsed: req.readableEnded,
      size: JSON.stringify(req.body ?? null).length,
    }),
  );
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const send = (path: string, kb: number): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "x".repeat(kb * 1024) }),
  });

describe("the shared JSON parser", () => {
  it("takes a small body anywhere", async () => {
    const r = await send("/api/prefs", 100);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { parsed: boolean }).parsed).toBe(true);
  });

  it("refuses a large one before any guard reads it", async () => {
    expect((await send("/api/prefs", 400)).status).toBe(413);
    expect((await send("/api/engines/heartbeat", 400)).status).toBe(413);
  });

  it("holds the public comment to its own 64 kb", async () => {
    expect((await send("/api/public/share/k/comments", 32)).status).toBe(200);
    expect((await send("/api/public/share/k/comments", 100)).status).toBe(413);
  });

  it("leaves the AI organize route its own larger limit", async () => {
    expect((await send("/api/ai/organize", 1024)).status).toBe(200);
  });

  it("never parses what the file hub pipes on, whatever its size", async () => {
    const r = await send(`${FILE_HUB_PATH}/workspace/file`, 4096);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { parsed: boolean }).parsed).toBe(false);
  });
});
