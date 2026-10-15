import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, PageVisibility } from "@studio/rehearsal-shared";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store opens K7_DATA_DIR at import, so it is set first.
process.env.K7_DATA_DIR = mkdtempSync(join(tmpdir(), "k7-public-pages-"));
const store = await import("./store.ts");
const db = await import("./db.ts");
const { publicPagesRouter, refusal } = await import("./routes/publicPages.ts");
const { pagesRouter } = await import("./routes/pages.ts");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stands in for cookie-session: `x-as` names the signed-in user, absent is nobody.
  app.use((req, _res, next) => {
    const sub = req.get("x-as");
    (req as { session?: unknown }).session = sub ? { user: { sub } } : {};
    next();
  });
  app.use("/api/public/pages", publicPagesRouter);
  app.use(
    "/api/pages",
    (req, _res, next) => {
      (req as { user?: { sub: string } }).user = { sub: "owner" };
      next();
    },
    pagesRouter,
  );
  server = createServer(app);
  await new Promise<void>((ok) => server.listen(0, ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  await store.createPage("owner", {
    nametag: "open",
    releaseIds: [],
    visibility: "public",
  });
  await store.createPage("owner", {
    nametag: "members",
    releaseIds: [],
    visibility: "authenticated",
  });
  await store.createPage("owner", {
    nametag: "mine",
    releaseIds: [],
    visibility: undefined,
  });
  // A row written before the field existed carries no Visibility at all.
  await db.addRecords("Pages", [
    { Uid: "legacy", OwnerId: "owner", Nametag: "older", ReleaseUids: "" },
  ]);
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const read = async (res: Response) =>
  (await res.json()) as Page & { ownerId?: string };

const get = (path: string, as?: string) =>
  fetch(`${base}/api/public/pages/${path}`, {
    headers: as ? { "x-as": as } : {},
  });

describe("refusal", () => {
  it("grades a page by its visibility and the viewer", () => {
    const page = (visibility: PageVisibility) => ({
      visibility,
      ownerId: "owner",
    });
    expect(refusal(page("public"), null)).toBe(null);
    expect(refusal(page("authenticated"), null)).toBe(401);
    expect(refusal(page("authenticated"), "someone")).toBe(null);
    expect(refusal(page("private"), null)).toBe(404);
    expect(refusal(page("private"), "someone")).toBe(404);
    expect(refusal(page("private"), "owner")).toBe(null);
  });
});

describe("the nametag route", () => {
  it("opens a public page to anyone, without its owner", async () => {
    const res = await get("open");
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.visibility).toBe("public");
    expect(body.ownerId).toBeUndefined();
  });

  it("asks a stranger to sign in for an authenticated page", async () => {
    expect((await get("members")).status).toBe(401);
    expect((await get("members", "someone")).status).toBe(200);
  });

  it("answers 404 to everyone but the owner of a private page", async () => {
    expect((await get("mine")).status).toBe(404);
    expect((await get("mine", "someone")).status).toBe(404);
    expect((await get("mine", "owner")).status).toBe(200);
  });

  it("keeps a page older than the field public", async () => {
    const res = await get("older");
    expect(res.status).toBe(200);
    expect((await read(res)).visibility).toBe("public");
  });

  it("gates the audio before looking for the release", async () => {
    expect((await get("members/releases/r/versions/v/audio")).status).toBe(401);
    expect((await get("mine/releases/r/versions/v/download")).status).toBe(404);
  });
});

describe("the owner's routes", () => {
  const send = (method: string, path: string, body: unknown) =>
    fetch(`${base}/api/pages${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("creates a page private, and changes who opens it", async () => {
    const created = await send("POST", "", { nametag: "fresh" });
    expect(created.status).toBe(201);
    const page = await read(created);
    expect(page.visibility).toBe("private");
    expect((await get("fresh")).status).toBe(404);

    const patched = await send("PATCH", `/${page.id}`, {
      visibility: "public",
    });
    expect((await read(patched)).visibility).toBe("public");
    expect((await get("fresh")).status).toBe(200);
  });

  it("refuses a visibility it does not know", async () => {
    const page = await read(await send("POST", "", { nametag: "odd" }));
    const res = await send("PATCH", `/${page.id}`, { visibility: "friends" });
    expect(res.status).toBe(400);
  });
});
