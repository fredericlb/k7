import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SlskdCheck } from "@studio/web-protocol/settings";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { slskdOf } from "../settings/store.ts";
import { settingsRouter } from "./settings.ts";

let dir: string;
let server: Server;
let base: string;
let groups: string[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "settings-http-"));
  process.env.STUDIO_SETTINGS_DIR = dir;
  process.env.SESSION_SECRET = "test-secret";
  process.env.AUTH_ADMIN_GROUPS = "admins";
  const app = express();
  app.use(express.json());
  app.use(
    "/api/settings",
    (req, _res, next) => {
      (req as { user?: unknown }).user = {
        sub: "u",
        email: "u@x.test",
        groups,
      };
      next();
    },
    settingsRouter,
  );
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}/api/settings`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
  delete process.env.STUDIO_SETTINGS_DIR;
  delete process.env.AUTH_ADMIN_GROUPS;
  groups = [];
});

const FORM = {
  url: "http://127.0.0.1:1",
  sftpHost: "",
  sftpPort: 22,
  sftpUser: "",
  downloadsDir: "",
};

const put = (body: unknown) =>
  fetch(`${base}/slskd`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("settings routes", () => {
  it("refuse a signed-in user who is not an admin, on all three calls", async () => {
    groups = ["users"];
    expect((await fetch(`${base}/slskd`)).status).toBe(403);
    expect((await put({ ...FORM, apiKey: "K" })).status).toBe(403);
    expect(
      (await fetch(`${base}/slskd/check`, { method: "POST" })).status,
    ).toBe(403);
    expect(slskdOf()).toBeNull();
  });

  it("tell any signed-in user whether they are an admin", async () => {
    groups = ["users"];
    expect(await (await fetch(`${base}/admin`)).json()).toEqual({
      admin: false,
    });
    groups = ["Admins"];
    expect(await (await fetch(`${base}/admin`)).json()).toEqual({
      admin: true,
    });
  });

  it("let an admin save, and the check answers no raw error text", async () => {
    groups = ["admins"];
    expect((await put({ ...FORM, apiKey: "K" })).status).toBe(200);
    expect(slskdOf()).toEqual({ url: "http://127.0.0.1:1", key: "K" });
    const check = (await (
      await fetch(`${base}/slskd/check`, { method: "POST" })
    ).json()) as SlskdCheck;
    expect(check.slskd.ok).toBe(false);
    expect(check.slskd.detail).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|fetch/i);
  });
});
