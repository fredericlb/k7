import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryRouter } from "./library.ts";

// The router alone, with no auth in front: what this covers is the upload's own contract —
// which status a caller gets and what lands on disk. Who may call it is server.ts's job.
let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mediatek-http-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  const app = express();
  // Mounted the way server.ts mounts it, json parser included: a global json() ahead of a
  // raw() route is exactly the arrangement that silently eats a body when it guesses wrong.
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/mediatek", libraryRouter);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const post = (q: Record<string, string>, body: string): Promise<Response> =>
  fetch(`${base}/api/mediatek/morceau?${new URLSearchParams(q)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });

const tags = {
  filename: "whatever.mp3",
  artist: "Miles Davis",
  album: "Kind of Blue",
  title: "So What",
};
const folder = () =>
  join(root, "morceaux/imported/Miles Davis/Kind of Blue/So What");

describe("pushing a recording", () => {
  const push = (q: Record<string, string>, body: string): Promise<Response> =>
    fetch(`${base}/api/mediatek/recording?${new URLSearchParams(q)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
    });

  it("files it under the day and second the caller names", async () => {
    const res = await push(
      {
        filename: "take.mp3",
        at: new Date(2026, 7, 3, 21, 5, 7).toISOString(),
      },
      "ID3",
    );
    expect(res.status).toBe(200);
    // A ROOT zone: `recordings/…`, beside the families rather than inside morceaux.
    expect(await res.json()).toMatchObject({
      path: "recordings/2026-08-03/21-05-07.mp3",
      day: "2026-08-03",
    });
  });

  it("refuses a timestamp it cannot read", async () => {
    // Rather than falling back to now: a caller that sent one cares where the file lands.
    const res = await push({ filename: "take.mp3", at: "hier soir" }, "ID3");
    expect(res.status).toBe(400);
  });

  it("refuses a non-audio file and an empty body", async () => {
    expect((await push({ filename: "notes.txt" }, "x")).status).toBe(400);
    expect((await push({ filename: "take.mp3" }, "")).status).toBe(400);
  });

  it("shows up in the zone's listing and in NO catalogue listing", async () => {
    await push(
      {
        filename: "take.mp3",
        at: new Date(2026, 7, 3, 21, 5, 7).toISOString(),
      },
      "ID3",
    );
    const zone = (await (
      await fetch(`${base}/api/mediatek/recordings`)
    ).json()) as { days: { day: string; files: { name: string }[] }[] };
    expect(zone.days[0].day).toBe("2026-08-03");
    expect(zone.days[0].files[0].name).toBe("21-05-07.mp3");

    const listed = (await (
      await fetch(`${base}/api/mediatek/list?family=morceaux`)
    ).json()) as { entries: unknown[] };
    expect(listed.entries).toEqual([]);
  });
});

describe("uploading a morceau", () => {
  it("creates the deduced tree from the tags alone", async () => {
    const res = await post(tags, "ID3-bytes");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      path: "morceaux/imported/Miles Davis/Kind of Blue/So What",
      master: "morceaux/imported/Miles Davis/Kind of Blue/So What/original.mp3",
      replaced: false,
    });
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe(
      "ID3-bytes",
    );
    expect(existsSync(join(folder(), "morceau.yaml"))).toBe(true);
  });

  it("answers 409 rather than clobbering, and replaces when told to", async () => {
    await post(tags, "first");
    const again = await post(tags, "second");
    expect(again.status).toBe(409);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("first");

    const forced = await post({ ...tags, replace: "1" }, "second");
    expect(forced.status).toBe(200);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("second");
  });

  it("refuses what is not audio, and an empty body", async () => {
    expect((await post({ ...tags, filename: "cover.jpg" }, "x")).status).toBe(
      400,
    );
    expect((await post(tags, "")).status).toBe(400);
  });

  it("cannot be talked into writing outside its family", async () => {
    // A tag is not a path: the separators become spaces, so this lands in a comically
    // named folder INSIDE morceaux/imported and nowhere else.
    const res = await post({ ...tags, artist: "../../.." }, "x");
    expect(res.status).toBe(200);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(/^morceaux\/imported\//);
  });
});
