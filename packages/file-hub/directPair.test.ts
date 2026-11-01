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
