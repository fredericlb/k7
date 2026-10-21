// liveServers.test.ts — the servers a service syncs with, from its environment, and the folder a workspace from
// a second server takes when its name is already used here. See docs/liveCapture.md, "Several servers".

import { afterEach, describe, expect, it } from "vitest";
import {
  fromPage,
  localNameFor,
  mainServer,
  syncServers,
  toPage,
} from "./liveServers.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("syncServers", () => {
  it("is the main server alone when no list is given", () => {
    process.env.STUDIO_SYNC_URL = "wss://app.k7.rocks/api/sync";
    process.env.STUDIO_SYNC_TOKEN = "t";
    delete process.env.STUDIO_SYNC_SERVERS;
    expect(syncServers()).toEqual([
      {
        url: "wss://app.k7.rocks/api/sync",
        auth: { token: "t" },
        main: true,
        own: false,
      },
    ]);
  });

  it("on a server, is its own relay by the hub's secret, the pairings beside it", () => {
    const own = "ws://127.0.0.1:8789/api/sync";
    process.env.STUDIO_SYNC_URL = own;
    process.env.STUDIO_HUB_SECRET = "hs";
    delete process.env.STUDIO_SYNC_TOKEN;
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: own, own: true, main: true },
      { url: "wss://band.test/api/sync", token: "tb", main: false },
    ]);
    expect(syncServers()).toEqual([
      { url: own, auth: { secret: "hs" }, main: true, own: true },
      {
        url: "wss://band.test/api/sync",
        auth: { token: "tb" },
        main: false,
        own: false,
      },
    ]);
    // The page knows this server by the origin it reached it at, never by its loopback relay.
    expect(toPage(own, "https://home.test")).toBe("https://home.test");
    expect(toPage("wss://band.test/api/sync", "https://home.test")).toBe(
      "https://band.test",
    );
    expect(fromPage("https://home.test", "https://home.test")).toBe(own);
    expect(fromPage("https://band.test", "https://home.test")).toBe(
      "https://band.test",
    );
  });

  it("reads every pairing, the main one first", () => {
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: "wss://b.org/api/sync", token: "tb", main: false },
      { url: "wss://a.org/api/sync", token: "ta", main: true },
    ]);
    expect(syncServers().map((s) => s.url)).toEqual([
      "wss://a.org/api/sync",
      "wss://b.org/api/sync",
    ]);
    expect(mainServer()?.url).toBe("wss://a.org/api/sync");
  });
});

describe("localNameFor", () => {
  const server = {
    url: "wss://app.priv.k7.rocks:8443/api/sync",
    auth: { token: "t" },
    main: false,
    own: false,
  };

  it("keeps the room's name when it is free here", () => {
    expect(localNameFor("band", server, () => false)).toBe("band");
  });

  it("suffixes it with the server's host, a name the workspace rules allow", () => {
    const taken = new Set(["band"]);
    expect(localNameFor("band", server, (n) => taken.has(n))).toBe(
      "band.app.priv.k7.rocks-8443",
    );
  });

  it("numbers it when that is taken too", () => {
    const taken = new Set(["band", "band.app.priv.k7.rocks-8443"]);
    expect(localNameFor("band", server, (n) => taken.has(n))).toBe(
      "band.app.priv.k7.rocks-8443-2",
    );
  });
});
