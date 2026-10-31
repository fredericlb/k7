// directPair.test.ts — pairing with no browser: the server's route as a machine's backend calls it (accepted, the
// wrong provider, a client not allowed, the provider refusing, the rate limit), and the machine's side, falling back.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceTokens } from "./deviceTokens.ts";
import type { DirectPairServer, ProviderWord } from "./directPair.ts";
import { accountKey } from "./instances.ts";
import { readRemotes } from "./syncRemote.ts";
import { type SyncContext, SyncRoutes } from "./syncRoutes.ts";

const EVE = "eve@example.com";
const ISSUER = "https://login.test";
const ROUTE = "/api/sync/pair/direct";
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0))
    await new Promise((r) => s.close(() => r(null)));
});

async function listen(app: express.Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const base = (dataRoot: string, remotePairing: boolean) => ({
  dataRoot,
  librariesHome: join(dataRoot, "_libraries"),
  librarySecret: "s",
  instances: {
    restart: async () => {},
  } as unknown as SyncContext["instances"],
  userOf: (req: express.Request) => String(req.headers["x-test-session"] ?? ""),
  isLocal: (req: express.Request) => req.headers["x-test-local"] === "1",
  subjectOf: () => "",
  relay: () => null,
  remotePairing,
});

/** The server: its direct route, the provider's word for each token given by `words`. */
async function server(
  words: Record<string, ProviderWord> = {},
  opts: Partial<DirectPairServer> = {},
) {
  const dataRoot = mkdtempSync(join(tmpdir(), "direct-server-"));
  const devices = new DeviceTokens(Buffer.from("k"), (s) => join(dataRoot, s));
  const routes = new SyncRoutes({
    ...base(dataRoot, false),
    devices,
    direct: {
      server: {
        issuer: ISSUER,
        clients: ["desktop"],
        verify: async (t) => words[t] ?? null,
        ...opts,
      },
    },
  });
  const app = express();
  const handler = routes.directPairHandler();
  if (handler) app.post(ROUTE, express.json(), handler);
  return { url: await listen(app), devices };
}

const call = (url: string, token: string | null, body: object = {}) =>
  fetch(`${url}${ROUTE}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ issuer: ISSUER, name: "Laptop", ...body }),
  });

const EVE_WORD: ProviderWord = {
  email: EVE,
  sub: "s-eve",
  clientId: "desktop",
};

describe("the server's direct route", () => {
  it("mints a device token for the account the provider names", async () => {
    const s = await server({ good: EVE_WORD });
    const r = await call(s.url, "good");
    expect(r.status).toBe(200);
    const a = (await r.json()) as Record<string, string>;
    expect(a.identity).toBe(EVE);
    expect(a.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/api\/sync$/);
    expect(s.devices.verify(a.token)).toMatchObject({ slug: accountKey(EVE) });
    expect(s.devices.list(accountKey(EVE))[0]?.name).toBe("Laptop");
  });

  it("refuses a token from another provider without asking its own", async () => {
    let asked = 0;
    const s = await server(
      {},
      {
        verify: async () => {
          asked++;
          return EVE_WORD;
        },
      },
    );
    const r = await call(s.url, "good", { issuer: "https://elsewhere.test" });
    expect(r.status).toBe(401);
    expect(asked).toBe(0);
  });

  it("refuses a token issued to a client not allowed, or to no client it can tell", async () => {
    const s = await server({
      other: { ...EVE_WORD, clientId: "someone-else" },
      unknown: { ...EVE_WORD, clientId: null },
    });
    expect((await call(s.url, "other")).status).toBe(401);
    expect((await call(s.url, "unknown")).status).toBe(401);
  });

  it("refuses what the provider refuses, and a call with no bearer, saying no more", async () => {
    const s = await server();
    const r = await call(s.url, "forged");
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toMatch(
      /not accepted/,
    );
    expect((await call(s.url, null)).status).toBe(401);
  });

  it("answers 429 past a few attempts a minute from one address", async () => {
    const s = await server();
    for (let i = 0; i < 5; i++)
      expect((await call(s.url, "forged")).status).toBe(401);
    expect((await call(s.url, "forged")).status).toBe(429);
  });

  it("is not mounted on a machine, nor on a server with no client allowed", async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "direct-none-"));
    const devices = {} as SyncContext["devices"];
    const server: DirectPairServer = {
      issuer: ISSUER,
      clients: [],
      verify: async () => null,
    };
    for (const remotePairing of [true, false])
      expect(
        new SyncRoutes({
          ...base(dataRoot, remotePairing),
          devices,
          direct: { server },
        }).directPairHandler(),
      ).toBeNull();
  });
});

/** A machine whose signed-in session holds `token`, trusting `o.test`, which is `serverUrl`. */
async function machine(serverUrl: string, token: string | null) {
  const dataRoot = mkdtempSync(join(tmpdir(), "direct-machine-"));
  const restarted: string[] = [];
  const paired: [string, string][] = [];
  const routes = new SyncRoutes({
    ...base(dataRoot, true),
    instances: {
      restart: async (u: string) => void restarted.push(u),
    } as unknown as SyncContext["instances"],
    devices: {} as SyncContext["devices"],
    selfPort: () => 0,
    onPaired: (origin, t) => paired.push([origin, t]),
    direct: {
      client: {
        issuer: ISSUER,
        servers: ["o.test"],
        tokenOf: async () => token,
        fetch: (input, init) =>
          fetch(String(input).replace("https://o.test", serverUrl), init),
      },
    },
  });
  const app = express();
  app.use("/api/sync/remote/pair", routes.pairRouter());
  const url = await listen(app);
  const post = async (body: object, local = false) => {
    const r = await fetch(`${url}/api/sync/remote/pair`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-session": EVE,
        ...(local ? { "x-test-local": "1" } : {}),
      },
      body: JSON.stringify(body),
    });
    return (await r.json()) as {
      url: string | null;
      pairing: { phase: string; browserAs: string | null; token: string };
    };
  };
  const offer = async () =>
    (await (
      await fetch(`${url}/api/sync/remote/pair?origin=o.test`, {
        headers: { "x-test-session": EVE },
      })
    ).json()) as { direct: boolean; directHosts: string[] };
  return {
    post,
    offer,
    restarted,
    paired,
    home: join(dataRoot, accountKey(EVE)),
  };
}

describe("the machine's side", () => {
  it("pairs at once with a trusted server that takes its token, and stores the link as the browser's return does", async () => {
    const s = await server({ good: EVE_WORD });
    const m = await machine(s.url, "good");
    expect(await m.offer()).toMatchObject({
      direct: true,
      directHosts: ["o.test"],
    });
    const a = await m.post({ origin: "o.test", name: "Laptop" });
    expect(a.url).toBeNull();
    expect(a.pairing).toMatchObject({ phase: "paired", browserAs: EVE });
    const [link] = readRemotes(m.home);
    expect(link).toMatchObject({
      url: "wss://o.test/api/sync",
      as: EVE,
      active: true,
    });
    expect(a.pairing.token).toBe(link?.token);
    expect(m.restarted).toEqual([EVE]);
    expect(m.paired).toEqual([["https://o.test", link?.token]]);
  });

  it("falls back to the browser when the server refuses the token", async () => {
    const s = await server();
    const m = await machine(s.url, "expired");
    const a = await m.post({ origin: "o.test" });
    expect(a.url).toContain("/api/sync/devices/pair");
    expect(a.pairing.phase).toBe("waiting");
    expect(readRemotes(m.home)).toEqual([]);
  });

  it("falls back to the browser when the server has no direct route", async () => {
    const m = await machine(await listen(express()), "good");
    expect((await m.post({ origin: "o.test" })).pairing.phase).toBe("waiting");
  });

  it("sends nothing to a server it does not trust, and nothing without a token", async () => {
    let hit = 0;
    const app = express();
    app.post(ROUTE, (_req, res) => {
      hit++;
      res.status(401).end();
    });
    const url = await listen(app);
    const m = await machine(url, "good");
    expect((await m.post({ origin: "elsewhere.test" })).pairing.phase).toBe(
      "waiting",
    );
    const none = await machine(url, null);
    expect(await none.offer()).toMatchObject({
      direct: false,
      directHosts: [],
    });
    expect((await none.post({ origin: "o.test" })).pairing.phase).toBe(
      "waiting",
    );
    expect(hit).toBe(0);
  });

  it("always takes the browser for the local user and for another account", async () => {
    const s = await server({ good: EVE_WORD });
    const m = await machine(s.url, "good");
    expect((await m.post({ origin: "o.test" }, true)).url).toBeTruthy();
    expect(
      (await m.post({ origin: "o.test", another: true })).url,
    ).toBeTruthy();
    expect(readRemotes(m.home)).toEqual([]);
  });
});
