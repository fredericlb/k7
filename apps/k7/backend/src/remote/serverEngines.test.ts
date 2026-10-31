import type { PublicEngine, ServerEngines } from "@studio/web-protocol";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { DEVICE_HEADER, DOOR_PATH } from "./door.ts";
import {
  SERVER_ENGINES_TTL_MS,
  serverEnginesRoute,
  throughServer,
} from "./serverEngines.ts";

const engine = (
  id: string,
  extra: Partial<PublicEngine> = {},
): PublicEngine => ({
  id,
  hostname: id.toUpperCase(),
  addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
  assigned: false,
  sameSourceIp: false,
  proxyTicket: `ticket-${id}`,
  access: "owner",
  ...extra,
});

const VIA = { origin: "https://app.k7.rocks", host: "app.k7.rocks" };
const LINK = {
  base: "https://app.k7.rocks",
  token: "dev-tok",
  account: "fred@example.com",
};

/** Call the route once and resolve what it answered. */
function call(
  route: ReturnType<typeof serverEnginesRoute>,
): Promise<ServerEngines> {
  return new Promise((resolve) => {
    const res = {
      json: (b: ServerEngines) => resolve(b),
    } as unknown as Response;
    route({} as Request, res, () => {});
  });
}

const answering = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("throughServer", () => {
  it("keeps what the account may drive, marked via the server, without WebRTC", () => {
    const out = throughServer(
      [
        engine("tom", { rtc: true }),
        engine("box", { access: "shared", ownedBy: "ann@example.com" }),
        engine("srv", { access: "server", server: true }),
      ],
      VIA,
    );
    expect(out.map((e) => e.id)).toEqual(["tom", "box", "srv"]);
    expect(out.every((e) => e.via?.host === "app.k7.rocks")).toBe(true);
    expect(out[0].rtc).toBeUndefined();
    expect(out[0].proxyTicket).toBe("ticket-tom");
  });

  it("drops an unowned stranger's engine and one with no relay ticket", () => {
    const out = throughServer(
      [
        engine("stranger", { access: "unowned" }),
        engine("old", { proxyTicket: undefined }),
      ],
      VIA,
    );
    expect(out).toEqual([]);
  });
});

describe("serverEnginesRoute", () => {
  it("answers no server when the account has no active server, asking nobody", async () => {
    const f = answering([]);
    const body = await call(serverEnginesRoute(() => null, f));
    expect(body).toEqual({ server: null, reachable: false, engines: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it("asks the server's device door with the link's token and marks each engine", async () => {
    const f = answering([engine("tom")]);
    const body = await call(serverEnginesRoute(() => LINK, f));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://app.k7.rocks${DOOR_PATH}/api/engines`);
    expect((init.headers as Record<string, string>)[DEVICE_HEADER]).toBe(
      "dev-tok",
    );
    expect(body.reachable).toBe(true);
    expect(body.server).toEqual({ ...VIA, account: "fred@example.com" });
    expect(body.engines[0].via?.account).toBe("fred@example.com");
  });

  it("shows none of the server's engines when it refuses or cannot be reached", async () => {
    const refused = await call(
      serverEnginesRoute(() => LINK, answering({ error: "repair" }, 401)),
    );
    expect(refused).toMatchObject({ reachable: false, engines: [] });
    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const unreachable = await call(serverEnginesRoute(() => LINK, down));
    expect(unreachable).toMatchObject({ reachable: false, engines: [] });
  });

  it("reuses one answer for a few seconds, then asks again", async () => {
    let t = 1_000;
    const f = answering([engine("tom")]);
    const route = serverEnginesRoute(
      () => LINK,
      f,
      () => t,
    );
    await call(route);
    await call(route);
    expect(f).toHaveBeenCalledTimes(1);
    t += SERVER_ENGINES_TTL_MS;
    await call(route);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("keeps two links' lists apart", async () => {
    const f = answering([engine("tom")]);
    let link = LINK;
    const route = serverEnginesRoute(() => link, f);
    await call(route);
    link = { ...LINK, token: "other-tok" };
    await call(route);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
