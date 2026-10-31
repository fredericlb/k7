// liveServers.test.ts — the link a service syncs with, from its environment, the saved servers whose workspaces it
// hides, and the folder a room takes when its name is already used here. See docs/liveCapture.md.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetRooms,
  isHiddenRecord,
  listRooms,
  localNameFor,
  mainServer,
  type SyncServer,
  serverForRecord,
  syncServers,
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
        id: "app.k7.rocks",
        url: "wss://app.k7.rocks/api/sync",
        auth: { token: "t" },
        main: true,
        own: false,
        home: true,
      },
    ]);
  });

  it("on a server, is its own relay by the hub's secret", () => {
    const own = "ws://127.0.0.1:8789/api/sync";
    process.env.STUDIO_SYNC_URL = own;
    process.env.STUDIO_HUB_SECRET = "hs";
    delete process.env.STUDIO_SYNC_TOKEN;
    delete process.env.STUDIO_SYNC_SERVERS;
    expect(syncServers()).toEqual([
      {
        id: "own",
        url: own,
        auth: { secret: "hs" },
        main: true,
        own: true,
        home: true,
      },
    ]);
  });

  it("reads the active link by the id and account the hub gave it", () => {
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      {
        url: "wss://a.org/api/sync",
        token: "ta",
        main: true,
        id: "l-a",
        as: "me@x",
        home: true,
      },
    ]);
    expect(mainServer()).toMatchObject({
      id: "l-a",
      as: "me@x",
      auth: { token: "ta" },
    });
  });
});

describe("the saved servers that are not the active one", () => {
  const activeBand = () => {
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      {
        url: "wss://a.org/api/sync",
        token: "band",
        main: true,
        id: "l-band",
        as: "band@x",
      },
    ]);
    process.env.STUDIO_SYNC_HIDDEN = JSON.stringify([
      { id: "l-mine", url: "wss://a.org/api/sync", home: true },
      { id: "l-b", url: "wss://b.org/api/sync", home: true },
    ]);
  };

  it("hide the workspaces their records name, never the active one's or a local one", () => {
    activeBand();
    const rec = (link: string, server = "https://a.org") => ({
      server,
      link,
      room: "r",
    });
    expect(isHiddenRecord(rec("l-mine"))).toBe(true);
    expect(isHiddenRecord(rec("l-b", "https://b.org"))).toBe(true);
    expect(isHiddenRecord(rec("l-band"))).toBe(false);
    expect(isHiddenRecord(null)).toBe(false);
    // A link let go hides nothing: its workspaces stay here, synced nowhere.
    expect(isHiddenRecord(rec("gone"))).toBe(false);
    expect(serverForRecord(rec("gone"))).toBeUndefined();
  });

  it("hide a record from before accounts when its host's home link is a hidden one", () => {
    activeBand();
    expect(isHiddenRecord({ server: "https://a.org", room: "r" })).toBe(true);
    expect(isHiddenRecord({ server: "https://b.org", room: "r" })).toBe(true);
    expect(isHiddenRecord({ server: "https://c.org", room: "r" })).toBe(false);
  });

  it("hide nothing when no other server is saved", () => {
    delete process.env.STUDIO_SYNC_HIDDEN;
    expect(
      isHiddenRecord({ server: "https://a.org", link: "l-mine", room: "r" }),
    ).toBe(false);
  });

  it("list nothing of their rooms: only the active link is asked", async () => {
    activeBand();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      asked.push(
        String((init.headers as Record<string, string>).authorization),
      );
      return new Response(JSON.stringify({ workspaces: ["gig"] }));
    });
    try {
      const all = syncServers();
      expect(all.map((s) => s.id)).toEqual(["l-band"]);
      expect(await listRooms(all[0], 0)).toEqual(["gig"]);
      expect(asked).toEqual(["Bearer band"]);
      forgetRooms(all[0]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("localNameFor", () => {
  const server: SyncServer = {
    id: "p",
    url: "wss://app.priv.k7.rocks:8443/api/sync",
    auth: { token: "t" },
    main: false,
    own: false,
    home: true,
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

describe("listRooms", () => {
  const server: SyncServer = {
    id: "rooms",
    url: "wss://rooms.test/api/sync",
    auth: { token: "t" },
    main: true,
    own: true,
    home: true,
  };
  const answering = (lists: string[][]): number[] => {
    let n = 0;
    const calls: number[] = [];
    vi.stubGlobal("fetch", async () => {
      calls.push(n);
      const workspaces = lists[Math.min(n++, lists.length - 1)];
      return new Response(JSON.stringify({ workspaces }));
    });
    return calls;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    forgetRooms(server);
  });

  it("answers a page from a stale list at once and asks again behind it", async () => {
    const calls = answering([["a"], ["a", "b"]]);
    expect(await listRooms(server, 30_000, true)).toEqual(["a"]);
    vi.useFakeTimers({ now: Date.now() + 60_000, toFake: ["Date"] });
    expect(await listRooms(server, 30_000, true)).toEqual(["a"]);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await vi.waitFor(async () =>
      expect(await listRooms(server, 30_000, true)).toEqual(["a", "b"]),
    );
  });

  it("waits for the relay once a move made it forget the list", async () => {
    answering([["a"], ["a", "moved"]]);
    await listRooms(server, 30_000, true);
    forgetRooms(server);
    expect(await listRooms(server, 30_000, true)).toEqual(["a", "moved"]);
  });
});
