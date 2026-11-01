// pairRoutes.test.ts — a machine's sign-in driven end to end: a real server half (code, trade, self-revoke) and a real
// machine half (start, return, link), the browser between them a fetch that follows the server's redirect by hand.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceTokens } from "./deviceTokens.ts";
import { accountKey } from "./instances.ts";
import { readRemotes } from "./syncRemote.ts";
import { type SyncContext, SyncRoutes } from "./syncRoutes.ts";

const EVE = "eve@example.com";
const LOCAL = "dev@example.com";
const servers: Server[] = [];

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A server: its pairing page behind a test session (`x-test-session`), the trade and the self-revoke with none. */
async function origin() {
  const dataRoot = mkdtempSync(join(tmpdir(), "pair-origin-"));
  const devices = new DeviceTokens(Buffer.from("key"), (slug) =>
    join(dataRoot, slug),
  );
  const routes = new SyncRoutes({
    dataRoot,
    librariesHome: join(dataRoot, "_libraries"),
    librarySecret: "s",
    devices,
    instances: {} as SyncContext["instances"],
    userOf: (req) => String(req.headers["x-test-session"] ?? ""),
    subjectOf: () => "sub-eve",
    relay: () => null,
    remotePairing: false,
  });
  const app = express();
  app.use("/api/sync/devices/redeem", routes.redeemRouter());
  app.delete("/api/sync/device", routes.selfRevokeHandler());
  app.get("/api/sync/devices/pair", routes.syncPairHandler());
  app.use("/api/sync/remote/pair", routes.pairRouter());
  const base = await listen(app);
  return { base, listed: () => devices.list(accountKey(EVE)) };
}

/** A machine, signed in nowhere: its local user is the one account it has. */
async function machine(
  dataRoot = mkdtempSync(join(tmpdir(), "pair-machine-")),
) {
  const paired: [string, string][] = [];
  const forgotten: string[] = [];
  let port = 0;
  const routes = new SyncRoutes({
    dataRoot,
    librariesHome: join(dataRoot, "_libraries"),
    librarySecret: "s",
    devices: {} as SyncContext["devices"],
    instances: {
      restart: async () => {},
    } as unknown as SyncContext["instances"],
    userOf: () => LOCAL,
    subjectOf: () => "",
    relay: () => null,
    remotePairing: true,
    selfPort: () => port,
    onPaired: (o, token) => paired.push([o, token]),
    onForgotten: (o) => forgotten.push(o),
  });
  const app = express();
  app.use("/api/sync/remote/pair", routes.pairRouter());
  app.use("/api/sync/remote", routes.remoteRouter());
  app.get("/desktop/sync-pair", routes.pairReturnHandler());
  const base = await listen(app);
  port = Number(new URL(base).port);
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${base}/api/sync/remote${path}`, {
      ...init,
      headers: { "content-type": "application/json" },
    });
  const begin = async (server: string, extra: object = {}) =>
    (await (
      await api("/pair", {
        method: "POST",
        body: JSON.stringify({ origin: server, name: "laptop", ...extra }),
      })
    ).json()) as { url: string; pairing: { state: string } };
  const links = () => readRemotes(join(dataRoot, accountKey(LOCAL)));
  return { dataRoot, base, api, begin, links, paired, forgotten };
}

/** The browser: signed in at the server as `who`, it opens the URL and follows the redirect to the return. */
async function browse(url: string, who = EVE): Promise<Response> {
  const there = await fetch(url, {
    headers: { "x-test-session": who },
    redirect: "manual",
  });
  return fetch(there.headers.get("location") ?? "");
}

afterEach(async () => {
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

describe("signing a machine in to its server", () => {
  it("links the account the person signed in as, and lists the engine there", async () => {
    const o = await origin();
    const m = await machine();
    const { url, pairing } = await m.begin(o.base);
    expect(new URL(url).searchParams.get("challenge")).toMatch(/^.{43}$/);
    const back = await browse(url);
    expect(back.status).toBe(200);
    expect(await back.text()).toContain(`as ${EVE}`);
    const [link] = m.links();
    expect(link.as).toBe(EVE);
    expect(o.listed()).toHaveLength(1);
    expect(m.paired).toEqual([[o.base, link.token]]);
    const ended = (await (await m.api(`/pair/${pairing.state}`)).json()) as {
      pairing: { phase: string; token: string };
    };
    expect(ended.pairing).toMatchObject({ phase: "paired", token: link.token });
  });

  it("keeps one server: a new sign-in replaces the link and hands the old token back", async () => {
    const o = await origin();
    const m = await machine();
    await browse((await m.begin(o.base)).url);
    await browse((await m.begin(o.base)).url);
    expect(m.links()).toHaveLength(1);
    // The revoke is not awaited by the return: give it its round trip.
    await new Promise((r) => setTimeout(r, 100));
    expect(o.listed()).toHaveLength(1);
  });

  it("stores nothing for a code it cannot trade", async () => {
    const o = await origin();
    const m = await machine();
    const { pairing } = await m.begin(o.base);
    const back = await fetch(
      `${m.base}/desktop/sync-pair?code=forged&state=${pairing.state}`,
    );
    expect(back.status).toBe(500);
    expect(m.links()).toHaveLength(0);
    expect(o.listed()).toHaveLength(0);
  });

  it("signing out forgets the link, revokes the device and lets the engine go", async () => {
    const o = await origin();
    const m = await machine();
    await browse((await m.begin(o.base)).url);
    await m.api("", { method: "DELETE" });
    await new Promise((r) => setTimeout(r, 100));
    expect(m.links()).toHaveLength(0);
    expect(o.listed()).toHaveLength(0);
    expect(m.forgotten).toEqual([o.base]);
  });

  it("finishes a sign-in that outlived its process, and serves a reload the same ending", async () => {
    const o = await origin();
    const first = await machine();
    const { url } = await first.begin(o.base);
    const there = await fetch(url, {
      headers: { "x-test-session": EVE },
      redirect: "manual",
    });
    // The backend started anew on the same data takes the return the browser was sent to.
    const again = await machine(first.dataRoot);
    const back = new URL(there.headers.get("location") ?? "");
    back.port = new URL(again.base).port;
    expect((await fetch(back)).status).toBe(200);
    expect((await fetch(back)).status).toBe(200);
    expect(again.links()).toHaveLength(1);
    expect(
      (await fetch(`${again.base}/desktop/sync-pair?state=x`)).status,
    ).toBe(404);
  });

  it("sends a phone's code to the app's own scheme", async () => {
    const o = await origin();
    const m = await machine();
    const { url } = await m.begin(o.base, { scheme: "se.frediver.k7" });
    expect(new URL(url).searchParams.get("return")).toBe(
      "se.frediver.k7://pair",
    );
    const there = await fetch(url, {
      headers: { "x-test-session": EVE },
      redirect: "manual",
    });
    expect(there.headers.get("location")).toMatch(
      /^se\.frediver\.k7:\/\/pair\?code=.+&state=/,
    );
  });

  it("a server adds no server, and sends a sign-in's code nowhere but the machine", async () => {
    const o = await origin();
    const refused = await fetch(`${o.base}/api/sync/remote/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-session": EVE },
      body: JSON.stringify({ origin: "https://other.test" }),
    });
    expect(refused.status).toBe(403);
    const elsewhere = await fetch(
      `${o.base}/api/sync/devices/pair?return=https://evil.test/x&state=s&challenge=${"a".repeat(43)}`,
      { headers: { "x-test-session": EVE }, redirect: "manual" },
    );
    expect(elsewhere.status).toBe(400);
  });
});
