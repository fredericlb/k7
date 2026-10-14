import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rawToDisk, uploadOf } from "./upload.ts";

let dir: string;
let server: Server;
let base: string;
let seen: string | null = null;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "upload-"));
  const app = express();
  app.use(express.json());
  app.put(
    "/up",
    rawToDisk(() => dir, 1000),
    (req, res) => {
      const up = uploadOf(req);
      seen = readFileSync(up.file, "utf8");
      res.json({ size: up.size });
    },
  );
  app.use(
    (
      err: Error & { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(err.status ?? 500).json({ error: err.message }),
  );
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
  seen = null;
});

const put = (body: string, type = "application/octet-stream") =>
  fetch(`${base}/up`, {
    method: "PUT",
    headers: { "content-type": type },
    body,
  });

describe("rawToDisk", () => {
  it("hands the route a file holding the body, and removes it once answered", async () => {
    const r = await put("hello");
    expect(await r.json()).toEqual({ size: 5 });
    expect(seen).toBe("hello");
    await new Promise((ok) => setTimeout(ok, 20));
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a body past its ceiling, and keeps none of it", async () => {
    const r = await put("x".repeat(2000));
    expect(r.status).toBe(413);
    await new Promise((ok) => setTimeout(ok, 20));
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("refuses a body the JSON parser already consumed, rather than waiting on a spent stream", async () => {
    const r = await put("{}", "application/json");
    expect(r.status).toBe(415);
  });
});
