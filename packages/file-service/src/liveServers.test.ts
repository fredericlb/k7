// liveServers.test.ts — the links a service syncs with, from its environment, two accounts on one server among them,
// and the folder a workspace from another link takes when its name is already used here. See docs/liveCapture.md.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetRooms,
  fromPage,
  listRooms,
  localNameFor,
  mainServer,
  type SyncServer,
  serverForRecord,
  serverOf,
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
        id: "app.k7.rocks",
        url: "wss://app.k7.rocks/api/sync",
        auth: { token: "t" },
        main: true,
        own: false,
        home: true,
      },
    ]);
  });

  it("on a server, is its own relay by the hub's secret, the pairings beside it", () => {
    const own = "ws://127.0.0.1:8789/api/sync";
    process.env.STUDIO_SYNC_URL = own;
    process.env.STUDIO_HUB_SECRET = "hs";
    delete process.env.STUDIO_SYNC_TOKEN;
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: own, own: true, main: true, id: "own", home: true },
      {
        url: "wss://band.test/api/sync",
        token: "tb",
        main: false,
        id: "b1",
        as: "me@x",
        home: true,
      },
    ]);
    expect(syncServers()).toEqual([
      {
        id: "own",
        url: own,
        auth: { secret: "hs" },
        main: true,
        own: true,
        home: true,
      },
      {
        id: "b1",
        url: "wss://band.test/api/sync",
        auth: { token: "tb" },
        main: false,
        own: false,
        as: "me@x",
        home: true,
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
    // A link's id goes through untouched.
    expect(fromPage("b1", "https://home.test")).toBe("b1");
  });

  it("reads every pairing, the main one first", () => {
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      { url: "wss://b.org/api/sync", token: "tb", main: false },
      { url: "wss://a.org/api/sync", token: "ta", main: true },
    ]);
    expect(syncServers().map((s) => [s.id, s.url])).toEqual([
      ["a.org", "wss://a.org/api/sync"],
      ["b.org", "wss://b.org/api/sync"],
    ]);
    expect(mainServer()?.url).toBe("wss://a.org/api/sync");
  });
});

describe("two accounts on one server", () => {
  const twoOnA = () => {
    process.env.STUDIO_SYNC_SERVERS = JSON.stringify([
      {
        url: "wss://a.org/api/sync",
        token: "band",
        main: true,
        id: "l-band",
        as: "band@x",
      },
      {
        url: "wss://a.org/api/sync",
        token: "mine",
        main: false,
        id: "l-mine",
        as: "me@x",
        home: true,
      },
    ]);
  };

  it("names each link by its id, and the server by its home link", () => {
    twoOnA();
    expect(serverOf("l-band")?.auth).toEqual({ token: "band" });
    expect(serverOf("l-mine")?.auth).toEqual({ token: "mine" });
    expect(serverOf("https://a.org")?.id).toBe("l-mine");
  });

  it("resolves a record from before accounts to the home link, and one whose link went to none", () => {
    twoOnA();
    expect(serverForRecord({ server: "https://a.org", room: "r" })?.id).toBe(
      "l-mine",
    );
    expect(
      serverForRecord({ server: "https://a.org", link: "l-band", room: "r" })
        ?.id,
    ).toBe("l-band");
    // Another account on that server never takes the workspaces of a link let go.
    expect(
      serverForRecord({ server: "https://a.org", link: "gone", room: "r" }),
    ).toBeUndefined();
  });

  it("lists each account's rooms on its own, by its own token", async () => {
    twoOnA();
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const auth = String(
        (init.headers as Record<string, string>).authorization,
      );
      asked.push(auth);
      const workspaces = auth.endsWith("band") ? ["gig"] : ["solo"];
      return new Response(JSON.stringify({ workspaces }));
    });
    try {
      const [band, mine] = syncServers();
      expect(await listRooms(band, 0)).toEqual(["gig"]);
      expect(await listRooms(mine, 0)).toEqual(["solo"]);
      expect(asked).toEqual(["Bearer band", "Bearer mine"]);
      forgetRooms(band);
      forgetRooms(mine);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("brings a room down under its account's name when the host's name is taken", () => {
    twoOnA();
    const band = serverOf("l-band") as SyncServer;
    const taken = new Set(["gig"]);
    expect(localNameFor("gig", band, (n) => taken.has(n))).toBe(
      "gig.a.org.band-x",
    );
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
    expect(localNameFor("band", server, () => false, false)).toBe("band");
  });

  it("suffixes it with the server's host, a name the workspace rules allow", () => {
    const taken = new Set(["band"]);
    expect(localNameFor("band", server, (n) => taken.has(n), false)).toBe(
      "band.app.priv.k7.rocks-8443",
    );
  });

  it("numbers it when that is taken too", () => {
    const taken = new Set(["band", "band.app.priv.k7.rocks-8443"]);
    expect(localNameFor("band", server, (n) => taken.has(n), false)).toBe(
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
