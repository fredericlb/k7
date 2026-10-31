// syncRemote.test.ts — an account's links: one MAIN and others beside it, several accounts on one server, the file
// from before secondaries read as the main one, and making another main or forgetting one. See docs/syncRelay.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  forgetRemote,
  linkId,
  originOfRelay,
  pairedServers,
  readRemote,
  readRemotes,
  setMainRemote,
  syncTarget,
  writeRemote,
} from "./syncRemote.ts";

const A = "wss://app.k7.rocks/api/sync";
const B = "wss://k7.example.org/api/sync";
const home = () => mkdtempSync(join(tmpdir(), "syncremote-"));
const pair = (url: string, main: boolean) => ({
  url,
  token: `t-${url}`,
  user: "me@example.org",
  main,
});

describe("an account's pairings", () => {
  it("reads a pairing from before secondaries as the main one", () => {
    const h = home();
    writeFileSync(
      join(h, ".sync-remote.json"),
      JSON.stringify({ url: A, token: "t", user: "me@example.org" }),
    );
    expect(readRemotes(h)).toEqual([
      {
        id: linkId(A, "me@example.org"),
        origin: "https://app.k7.rocks",
        url: A,
        token: "t",
        user: "me@example.org",
        as: "me@example.org",
        main: true,
      },
    ]);
  });

  it("keeps the first one main, adds the next beside it, the main one first", () => {
    const h = home();
    writeRemote(h, pair(A, false));
    writeRemote(h, pair(B, false));
    expect(readRemotes(h).map((r) => [r.url, r.main])).toEqual([
      [A, true],
      [B, false],
    ]);
    expect(readRemote(h)?.url).toBe(A);
  });

  it("makes another server main, the old one staying beside it", () => {
    const h = home();
    writeRemote(h, pair(A, true));
    writeRemote(h, pair(B, false));
    expect(setMainRemote(h, "https://k7.example.org")).toBe(true);
    expect(readRemote(h)?.url).toBe(B);
    expect(readRemotes(h)).toHaveLength(2);
  });

  it("replaces a pairing with the same server rather than listing it twice", () => {
    const h = home();
    writeRemote(h, pair(A, true));
    writeRemote(h, { ...pair(A, true), token: "fresh" });
    expect(readRemotes(h).map((r) => [r.url, r.token])).toEqual([[A, "fresh"]]);
  });

  it("links a second account on the same server beside the first, each by its own id", () => {
    const h = home();
    const mine = writeRemote(h, pair(A, true));
    const band = writeRemote(h, { ...pair(A, false), as: "band@example.org" });
    expect(mine.id).not.toBe(band.id);
    expect(readRemotes(h).map((r) => [r.as, r.main])).toEqual([
      ["me@example.org", true],
      ["band@example.org", false],
    ]);
    expect(setMainRemote(h, band.id)).toBe(true);
    expect(readRemote(h)?.as).toBe("band@example.org");
    // Forgotten by id, the other account on that server stays.
    expect(forgetRemote(h, band.id)).toBe(true);
    expect(readRemotes(h).map((r) => [r.as, r.main])).toEqual([
      ["me@example.org", true],
    ]);
  });

  it("derives a link's id from its host and account, whatever the path", () => {
    expect(linkId(A, "x@y")).toBe(linkId("wss://app.k7.rocks/other", "x@y"));
    expect(linkId(A, "x@y")).not.toBe(linkId(A, "z@y"));
    expect(linkId(A, "x@y")).toMatch(/^[0-9a-f]{10}$/);
  });

  it("forgets one server, and a main one gone hands main to the next", () => {
    const h = home();
    writeRemote(h, pair(A, true));
    writeRemote(h, pair(B, false));
    expect(forgetRemote(h, A)).toBe(true);
    expect(readRemotes(h).map((r) => [r.url, r.main])).toEqual([[B, true]]);
    expect(forgetRemote(h)).toBe(true);
    expect(readRemotes(h)).toEqual([]);
  });
});

describe("the servers a machine's engine is listed at", () => {
  it("names a relay's server as the origin the engine heartbeats to", () => {
    expect(originOfRelay(A)).toBe("https://app.k7.rocks");
    expect(originOfRelay("ws://127.0.0.1:8789/api/sync")).toBe(
      "http://127.0.0.1:8789",
    );
    expect(originOfRelay("not a url")).toBe("");
  });

  it("lists one token per server per account: the main link's, else the first on that server", () => {
    const root = home();
    const ann = join(root, "ann");
    mkdirSync(ann);
    writeRemote(ann, { ...pair(A, false), as: "first@x", token: "first" });
    writeRemote(ann, { ...pair(B, true), token: "b" });
    writeRemote(ann, { ...pair(A, false), as: "second@x", token: "second" });
    expect(pairedServers(root)).toEqual([
      { origin: "https://k7.example.org", token: "b" },
      { origin: "https://app.k7.rocks", token: "first" },
    ]);
    expect(setMainRemote(ann, linkId(A, "second@x"))).toBe(true);
    expect(pairedServers(root)).toContainEqual({
      origin: "https://app.k7.rocks",
      token: "second",
    });
  });

  it("lists every account's pairings with their tokens", () => {
    const root = home();
    const ann = join(root, "ann");
    const bob = join(root, "bob");
    mkdirSync(ann);
    mkdirSync(bob);
    writeRemote(ann, pair(A, true));
    writeRemote(ann, pair(B, false));
    writeRemote(bob, pair(B, true));
    writeFileSync(join(root, "a-file"), "");
    expect(
      pairedServers(root).sort((x, y) => x.token.localeCompare(y.token)),
    ).toEqual([
      { origin: "https://app.k7.rocks", token: `t-${A}` },
      { origin: "https://k7.example.org", token: `t-${B}` },
      { origin: "https://k7.example.org", token: `t-${B}` },
    ]);
    expect(pairedServers(join(root, "none"))).toEqual([]);
  });
});

describe("where an account's service syncs", () => {
  const own = "ws://127.0.0.1:8789/api/sync";
  const link = (url: string, token: string, main: boolean, as = "u") => ({
    id: linkId(url, as),
    origin: originOfRelay(url),
    url,
    token,
    user: "u",
    as,
    main,
  });
  const remotes = [link(A, "a", true), link(B, "b", false)];

  it("is this hub's own relay when nothing is paired", () => {
    expect(syncTarget(own, [], false)).toEqual({ STUDIO_SYNC_URL: own });
    expect(syncTarget(own, [], true)).toEqual({ STUDIO_SYNC_URL: own });
  });

  it("on a machine, is the main pairing, by its token", () => {
    const env = syncTarget(own, remotes, false);
    expect(env.STUDIO_SYNC_URL).toBe(A);
    expect(env.STUDIO_SYNC_TOKEN).toBe("a");
  });

  it("on a server, stays its own relay, every pairing a secondary beside it", () => {
    const env = syncTarget(own, remotes, true);
    expect(env.STUDIO_SYNC_URL).toBe(own);
    expect(env.STUDIO_SYNC_TOKEN).toBeUndefined();
    expect(JSON.parse(env.STUDIO_SYNC_SERVERS)).toEqual([
      { url: own, own: true, main: true, id: "own", home: true },
      {
        url: A,
        token: "a",
        main: false,
        id: linkId(A, "u"),
        as: "u",
        home: true,
      },
      {
        url: B,
        token: "b",
        main: false,
        id: linkId(B, "u"),
        as: "u",
        home: true,
      },
    ]);
  });

  it("marks, per server, the link a workspace recorded before accounts belongs to: the local account's own", () => {
    const other = link(A, "o", true, "other@x");
    const mine = link(A, "m", false);
    const env = syncTarget(own, [other, mine], false);
    const list = JSON.parse(env.STUDIO_SYNC_SERVERS) as {
      id: string;
      home?: boolean;
    }[];
    expect(list.filter((s) => s.home).map((s) => s.id)).toEqual([mine.id]);
    expect(env.STUDIO_SYNC_TOKEN).toBe("o");
  });
});
