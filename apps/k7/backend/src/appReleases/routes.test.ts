// routes.test.ts — the apps' downloads over a temp folder: the CI bearer, upload then publish per channel,
// the page, `<channel>.json` and the files, and that only a channel's current and previous builds stay.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonBodies } from "../bodyLimits.ts";
import { appDownloadsRouter, appReleasesRouter } from "./routes.ts";
import { appReleaseStore } from "./store.ts";

const root = mkdtempSync(join(tmpdir(), "k7-app-releases-"));
const store = appReleaseStore(root);
const TOKEN = "ci-secret";
let base = "";
let close = () => {};

beforeAll(async () => {
  const app = express();
  // As server.ts mounts it: behind the shared JSON parser, which must leave the upload alone.
  app.use(jsonBodies());
  app.use("/api/app-releases", appReleasesRouter(store, TOKEN, 64));
  app.use("/api/no-token", appReleasesRouter(store, undefined, 64));
  app.use("/app_downloads", appDownloadsRouter(store));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

afterAll(() => {
  close();
  rmSync(root, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };
const put = (stamp: string, file: string, body: string, headers = auth) =>
  fetch(`${base}/api/app-releases/${stamp}/${file}`, {
    method: "PUT",
    headers,
    body,
  });
const publish = (stamp: string) =>
  fetch(`${base}/api/app-releases/${stamp}/publish`, {
    method: "POST",
    headers: auth,
  });

/** The stamp `<channel>.json` names. */
const servedStamp = async (channel: string) =>
  (
    (await (await fetch(`${base}/app_downloads/${channel}.json`)).json()) as {
      stamp: string;
    }
  ).stamp;

async function build(stamp: string) {
  const exe = `k7_${stamp}_windows-x64.exe`;
  expect((await put(stamp, exe, "exe")).status).toBe(201);
  expect((await put(stamp, "latest.yml", `path: ${exe}`)).status).toBe(201);
  expect((await publish(stamp)).status).toBe(200);
}

describe("/api/app-releases", () => {
  it("refuses a missing or wrong bearer, and everyone when no token is set", async () => {
    expect((await put("v0.1.0", "a.exe", "x", {} as typeof auth)).status).toBe(
      401,
    );
    expect(
      (await put("v0.1.0", "a.exe", "x", { authorization: "Bearer nope" }))
        .status,
    ).toBe(401);
    const none = await fetch(`${base}/api/no-token/v0.1.0/a.exe`, {
      method: "PUT",
      headers: auth,
      body: "x",
    });
    expect(none.status).toBe(401);
  });

  it("refuses a stamp CI never makes, and a file name with a path in it", async () => {
    expect((await put("0.1.0", "a.exe", "x")).status).toBe(400);
    expect((await put("snapshot-xyz", "a.exe", "x")).status).toBe(400);
    expect((await put("v0.1.0", ".hidden", "x")).status).toBe(400);
    expect((await put("v0.1.0", "a%2Fb.exe", "x")).status).toBe(400);
  });

  it("refuses a file over the ceiling", async () => {
    expect((await put("v0.1.0", "big.exe", "x".repeat(65))).status).toBe(413);
  });

  it("takes a JSON-typed body raw rather than parsing it", async () => {
    const r = await put("v0.1.0", "x.json", '{"a":1}', {
      ...auth,
      "content-type": "application/json",
    } as typeof auth);
    expect(r.status).toBe(201);
    expect(((await r.json()) as { bytes: number }).bytes).toBe(7);
  });

  it("will not publish a stamp nothing was uploaded for", async () => {
    expect((await publish("v9.9.9")).status).toBe(404);
  });
});

describe("/app_downloads", () => {
  it("says there is nothing yet before a first publish", async () => {
    const r = await fetch(`${base}/app_downloads`, {
      headers: { "accept-language": "en" },
    });
    expect(await r.text()).toContain("No build published yet");
    expect((await fetch(`${base}/app_downloads/release.json`)).status).toBe(
      404,
    );
  });

  it("serves each channel's build on the page, as JSON and as files", async () => {
    await build("v0.1.0");
    await build("snapshot-aaaaaaa");
    const page = await (
      await fetch(`${base}/app_downloads`, {
        headers: { "accept-language": "fr" },
      })
    ).text();
    expect(page).toContain("Version 0.1.0");
    expect(page).toContain("Dernière build de main");
    expect(page).toContain(
      'href="app_downloads/release/k7_v0.1.0_windows-x64.exe"',
    );
    expect(page).toContain(
      'href="app_downloads/snapshot/k7_snapshot-aaaaaaa_windows-x64.exe"',
    );

    expect(await servedStamp("snapshot")).toBe("snapshot-aaaaaaa");
    const yml = await fetch(`${base}/app_downloads/release/latest.yml`);
    expect(await yml.text()).toBe("path: k7_v0.1.0_windows-x64.exe");
    expect(yml.headers.get("cache-control")).toBe("no-cache");
    const exe = await fetch(
      `${base}/app_downloads/release/k7_v0.1.0_windows-x64.exe`,
    );
    expect(exe.headers.get("content-disposition")).toBe("attachment");
    expect(await exe.text()).toBe("exe");
    // A channel serves its own files only.
    expect(
      (
        await fetch(
          `${base}/app_downloads/release/k7_snapshot-aaaaaaa_windows-x64.exe`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await fetch(`${base}/app_downloads/nightly/latest.yml`)).status,
    ).toBe(404);
  });

  it("keeps a channel's current and previous builds, and drops the one before", async () => {
    await build("snapshot-bbbbbbb");
    await build("snapshot-ccccccc");
    const dir = join(root, "snapshot");
    expect(existsSync(join(dir, "snapshot-aaaaaaa"))).toBe(false);
    expect(existsSync(join(dir, "snapshot-bbbbbbb"))).toBe(true);
    expect(
      (
        await fetch(
          `${base}/app_downloads/snapshot/k7_snapshot-bbbbbbb_windows-x64.exe`,
        )
      ).status,
    ).toBe(200);
    // The release channel is untouched by snapshots.
    expect(await servedStamp("release")).toBe("v0.1.0");
  });

  it("redirects a trailing slash, so the relative links resolve", async () => {
    const r = await fetch(`${base}/app_downloads/`, { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/app_downloads");
  });
});
