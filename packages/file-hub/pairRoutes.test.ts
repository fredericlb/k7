// pairRoutes.test.ts — a pairing driven as an app drives it: offered, started, ended by the browser's return on
// this backend's own port, waited for, told; and one that outlives the process it was started in.

import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { accountKey } from "./instances.ts";
import { readRemotes, writeRemote } from "./syncRemote.ts";
import { type SyncContext, SyncRoutes } from "./syncRoutes.ts";

const EVE = "eve@example.com";

/** What the routes answer, as far as these tests read it. */
interface Answer {
  paired?: boolean;
  pairing: { state: string; phase: string } | null;
  [key: string]: unknown;
}
const read = async (r: Response | Promise<Response>): Promise<Answer> =>
  (await (await r).json()) as Answer;
const servers: Server[] = [];

async function start(opts: {
  dataRoot?: string;
  remotePairing?: boolean;
  restart?: (u: string) => Promise<void>;
}) {
  const dataRoot = opts.dataRoot ?? mkdtempSync(join(tmpdir(), "pair-routes-"));
  const restarted: string[] = [];
  // What the machine's engine was told: listed at a server with a token, or let go of one.
  const paired: [string, string][] = [];
  const forgotten: string[] = [];
  let port = 0;
  const routes = new SyncRoutes({
    dataRoot,
    librariesHome: join(dataRoot, "_libraries"),
    librarySecret: "s",
    devices: {} as SyncContext["devices"],
    instances: {
      restart: opts.restart ?? (async (u: string) => void restarted.push(u)),
    } as unknown as SyncContext["instances"],
    userOf: (req) => String(req.headers["x-test-session"] ?? ""),
    isLocal: (req) => req.headers["x-test-local"] === "1",
    subjectOf: () => "",
    relay: () => null,
    remotePairing: opts.remotePairing ?? true,
    selfPort: () => port,
    onPaired: (origin, token) => paired.push([origin, token]),
    onForgotten: (origin) => forgotten.push(origin),
  });
  const app = express();
  app.use("/api/sync/remote/pair", routes.pairRouter());
  app.use("/api/sync/remote", routes.remoteRouter());
  app.get("/desktop/sync-pair", routes.pairReturnHandler());
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  // A server behind its proxy: the host and scheme the browser reached it at.
  const proxied: Record<string, string> =
    opts.remotePairing === false
      ? { "x-forwarded-host": "home.test", "x-forwarded-proto": "https" }
      : {};
  const api = (path: string, init: RequestInit = {}, who = EVE) =>
    fetch(`${base}/api/sync/remote/pair${path}`, {
      ...init,
      headers: {
        "x-test-session": who,
        "content-type": "application/json",
        ...proxied,
      },
    });
  const post = (body: object) =>
    api("", { method: "POST", body: JSON.stringify(body) });
  const begin = async (body: object = { origin: "o.test", name: "Pixel" }) =>
    (await (await post(body)).json()) as {
      url: string;
      pairing: { state: string };
    };
  // What the origin does with the pairing URL: redirect to its `return`, with a token and whose it is.
  const browser = (url: string, identity = EVE, token = "tok") => {
    const u = new URL(url);
    const back = new URL(u.searchParams.get("return") ?? "");
    // A server's return is its public origin; the test reaches it where it listens.
    if (back.protocol === "https:") back.href = `${base}${back.pathname}`;
    back.searchParams.set("token", token);
    back.searchParams.set("url", "wss://proxy-host.test/api/sync");
    back.searchParams.set("identity", identity);
    back.searchParams.set("state", u.searchParams.get("state") ?? "");
    return fetch(back);
  };
  const home = join(dataRoot, accountKey(EVE));
  mkdirSync(home, { recursive: true });
  return {
    dataRoot,
    base,
    api,
    post,
    begin,
    browser,
    home,
    restarted,
    paired,
    forgotten,
  };
}

afterEach(async () => {
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

describe("the machine's engine follows the pairings", () => {
  it("is listed at a server once paired, again when asked to add it twice, and let go with the sync", async () => {
    const t = await start({});
    const { url } = await t.begin();
    await t.browser(url, EVE, "tok-o");
    expect(t.paired).toEqual([["https://o.test", "tok-o"]]);
    // Synced already: the 409 lists the engine back, as a person re-adding it from the engine page means.
    expect((await t.post({ origin: "o.test" })).status).toBe(409);
    expect(t.paired.at(-1)).toEqual(["https://o.test", "tok-o"]);
    const gone = await fetch(
      `${t.base}/api/sync/remote?url=${encodeURIComponent("wss://o.test/api/sync")}`,
      { method: "DELETE", headers: { "x-test-session": EVE } },
    );
    expect(gone.ok).toBe(true);
    expect(t.forgotten).toEqual(["https://o.test"]);
  });

  it("names nothing for a pairing that came back as another account", async () => {
    const t = await start({});
    const { url } = await t.begin();
    await t.browser(url, "mallory@example.com");
    expect(t.paired).toEqual([]);
  });
});

describe("pairing through the browser", () => {
  it("offers, starts, and pairs on the browser's return to this backend", async () => {
    const t = await start({});
    const offer = await read(t.api("?origin=o.test"));
    expect(offer).toMatchObject({ email: EVE, local: false, paired: false });
    const { url, pairing } = await t.begin();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://o.test/api/sync/devices/pair");
    expect(u.searchParams.get("return")).toBe(`${t.base}/desktop/sync-pair`);
    expect(u.searchParams.get("name")).toBe("Pixel");
    const waited = t.api(`/${pairing.state}?wait=5000`);
    const tab = await t.browser(url);
    expect(tab.status).toBe(200);
    expect(await tab.text()).toContain("now syncs your workspaces");
    const { pairing: ended } = await read(waited);
    expect(ended).toMatchObject({
      phase: "paired",
      host: "o.test",
      token: "tok",
    });
    // The relay is the named server's, not the host the origin reported.
    expect(readRemotes(t.home)).toEqual([
      { url: "wss://o.test/api/sync", token: "tok", user: EVE, main: true },
    ]);
    expect(t.restarted).toEqual([EVE]);
    expect(
      (await t.api(`/${pairing.state}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect((await read(t.api("?origin=o.test"))).paired).toBe(true);
  });

  it("refuses a browser signed in as another account, and stores nothing", async () => {
    const t = await start({});
    const { url, pairing } = await t.begin();
    const tab = await t.browser(url, "bob@example.com");
    expect(tab.status).toBe(409);
    const { pairing: ended } = await read(t.api(`/${pairing.state}`));
    expect(ended).toMatchObject({
      phase: "otherAccount",
      browserAs: "bob@example.com",
      token: null,
    });
    expect(readRemotes(t.home)).toEqual([]);
    expect(t.restarted).toEqual([]);
  });

  it("ends a pairing that outlived its process: the backend started anew takes the return", async () => {
    const first = await start({});
    const { url, pairing } = await first.begin();
    // The app and its backend die behind the browser; the next start serves the same data root.
    const again = await start({ dataRoot: first.dataRoot });
    const back = new URL(new URL(url).searchParams.get("return") ?? "");
    back.port = new URL(again.base).port;
    const u = new URL(url);
    u.searchParams.set("return", back.toString());
    expect((await again.browser(u.toString())).status).toBe(200);
    const offer = await read(again.api("?origin=o.test"));
    expect(offer.pairing).toMatchObject({
      state: pairing.state,
      phase: "paired",
      token: "tok",
    });
    expect(again.restarted).toEqual([EVE]);
  });

  it("serves a reload the same ending, and a state it does not know a 404", async () => {
    const t = await start({});
    const { url } = await t.begin();
    expect((await t.browser(url)).status).toBe(200);
    expect((await t.browser(url, EVE, "other")).status).toBe(200);
    expect(readRemotes(t.home)[0]?.token).toBe("tok");
    const stray = await fetch(`${t.base}/desktop/sync-pair?state=nope`);
    expect(stray.status).toBe(404);
  });

  it("says not stored when the account's service cannot restart", async () => {
    const t = await start({
      restart: async () => {
        throw new Error("down");
      },
    });
    const { url, pairing } = await t.begin();
    expect((await t.browser(url)).status).toBe(500);
    const { pairing: ended } = await read(t.api(`/${pairing.state}`));
    expect(ended?.phase).toBe("notStored");
  });

  it("is cancelled by its account only", async () => {
    const t = await start({});
    const { url, pairing } = await t.begin();
    const del = (who: string) =>
      t.api(`/${pairing.state}`, { method: "DELETE" }, who);
    expect((await del("bob@example.com")).status).toBe(404);
    expect((await del(EVE)).status).toBe(200);
    expect((await t.browser(url)).status).toBe(404);
    expect(readRemotes(t.home)).toEqual([]);
  });

  it("starts nothing for the local user, a server already paired, or what is no server", async () => {
    const t = await start({});
    const post = (body: object, headers: Record<string, string> = {}) =>
      fetch(`${t.base}/api/sync/remote/pair`, {
        method: "POST",
        headers: {
          "x-test-session": EVE,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
      });
    expect(
      (await post({ origin: "o.test" }, { "x-test-local": "1" })).status,
    ).toBe(401);
    expect((await post({ origin: "http://lan.test" })).status).toBe(400);
    writeRemote(t.home, {
      url: "wss://o.test/api/sync",
      token: "t",
      user: EVE,
      main: true,
    });
    expect((await post({ origin: "https://o.test" })).status).toBe(409);
  });

  it("pairs a server added beside the main one as a secondary", async () => {
    const t = await start({});
    writeRemote(t.home, {
      url: "wss://o.test/api/sync",
      token: "t",
      user: EVE,
      main: true,
    });
    const { url } = await t.begin({
      origin: "band.test",
      name: "Mac",
      main: false,
    });
    await t.browser(url);
    expect(readRemotes(t.home).map((r) => [r.url, r.main])).toEqual([
      ["wss://o.test/api/sync", true],
      ["wss://band.test/api/sync", false],
    ]);
  });

  it("on a server, pairs a secondary that returns to the server's own https origin", async () => {
    const t = await start({ remotePairing: false });
    const { url, pairing } = await t.begin({ origin: "band.test", main: true });
    const u = new URL(url);
    expect(u.searchParams.get("return")).toBe(
      "https://home.test/desktop/sync-pair",
    );
    // Named after the server on the other one's list of devices.
    expect(u.searchParams.get("name")).toBe("home.test");
    expect((await t.browser(url)).status).toBe(200);
    const { pairing: ended } = await read(t.api(`/${pairing.state}`));
    // A server's page is never handed the token.
    expect(ended).toMatchObject({ phase: "paired", main: false, token: null });
    expect(readRemotes(t.home).map((r) => r.url)).toEqual([
      "wss://band.test/api/sync",
    ]);
  });

  it("on a server, refuses to pair with itself", async () => {
    const t = await start({ remotePairing: false });
    expect((await t.post({ origin: "home.test" })).status).toBe(400);
  });
});
