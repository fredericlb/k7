// liveServers.test.ts — the servers a service syncs with, from its environment, and the folder a workspace from
// a second server takes when its name is already used here. See docs/liveCapture.md, "Several servers".

import { afterEach, describe, expect, it } from "vitest";
import { localNameFor, mainServer, syncServers } from "./liveServers.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("syncServers", () => {
  it("is the main server alone when no list is given", () => {
    process.env.STUDIO_SYNC_URL = "wss://st0.app/api/sync";
    process.env.STUDIO_SYNC_TOKEN = "t";
    delete process.env.STUDIO_SYNC_SERVERS;
    expect(syncServers()).toEqual([
      { url: "wss://st0.app/api/sync", auth: { token: "t" }, main: true },
    ]);
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
    url: "wss://priv.st0.app:8443/api/sync",
    auth: { token: "t" },
    main: false,
  };

  it("keeps the room's name when it is free here", () => {
    expect(localNameFor("band", server, () => false)).toBe("band");
  });

  it("suffixes it with the server's host, a name the workspace rules allow", () => {
    const taken = new Set(["band"]);
    expect(localNameFor("band", server, (n) => taken.has(n))).toBe(
      "band.priv.st0.app-8443",
    );
  });

  it("numbers it when that is taken too", () => {
    const taken = new Set(["band", "band.priv.st0.app-8443"]);
    expect(localNameFor("band", server, (n) => taken.has(n))).toBe(
      "band.priv.st0.app-8443-2",
    );
  });
});
