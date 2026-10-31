// syncRemote.test.ts — an account's saved servers: exactly one ACTIVE, adding one switches to it, several accounts on
// one server, the file holding one pairing or `main` marks read as active, switching and forgetting. See docs/syncRelay.md.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  engineMoves,
  forgetRemote,
  linkId,
  originOfRelay,
  pairedServers,
  readRemote,
  readRemotes,
  setActiveRemote,
  syncTarget,
  writeRemote,
} from "./syncRemote.ts";

const A = "wss://app.k7.rocks/api/sync";
const B = "wss://k7.example.org/api/sync";
const home = () => mkdtempSync(join(tmpdir(), "syncremote-"));
const pair = (url: string) => ({
  url,
  token: `t-${url}`,
  user: "me@example.org",
});

describe("an account's saved servers", () => {
  it("reads a file holding one pairing as that pairing, active", () => {
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
        active: true,
      },
    ]);
  });

  it("reads a list marked with `main` as marked with `active`", () => {
    const h = home();
    const entry = (url: string, main: boolean) => ({
      ...pair(url),
      as: "me@example.org",
      main,
    });
    writeFileSync(
      join(h, ".sync-remote.json"),
      JSON.stringify({ servers: [entry(A, false), entry(B, true)] }),
    );
    expect(readRemotes(h).map((r) => [r.url, r.active])).toEqual([
      [B, true],
      [A, false],
    ]);
  });

  it("makes the server just added the active one, the others saved beside it", () => {
    const h = home();
    writeRemote(h, pair(A));
    writeRemote(h, pair(B));
    expect(readRemotes(h).map((r) => [r.url, r.active])).toEqual([
      [B, true],
      [A, false],
    ]);
    expect(readRemote(h)?.url).toBe(B);
  });

  it("switches to another saved server, the old one staying saved", () => {
    const h = home();
    writeRemote(h, pair(A));
    writeRemote(h, pair(B));
    expect(setActiveRemote(h, "https://app.k7.rocks")).toBe(true);
    expect(readRemote(h)?.url).toBe(A);
    expect(readRemotes(h)).toHaveLength(2);
    expect(setActiveRemote(h, "nope")).toBe(false);
  });

  it("replaces a pairing with the same server rather than listing it twice", () => {
    const h = home();
    writeRemote(h, pair(A));
    writeRemote(h, { ...pair(A), token: "fresh" });
    expect(readRemotes(h).map((r) => [r.url, r.token])).toEqual([[A, "fresh"]]);
  });

  it("saves a second account on the same server beside the first, each by its own id", () => {
    const h = home();
    const mine = writeRemote(h, pair(A));
    const band = writeRemote(h, { ...pair(A), as: "band@example.org" });
    expect(mine.id).not.toBe(band.id);
    expect(readRemotes(h).map((r) => [r.as, r.active])).toEqual([
      ["band@example.org", true],
      ["me@example.org", false],
    ]);
    expect(setActiveRemote(h, mine.id)).toBe(true);
    expect(readRemote(h)?.as).toBe("me@example.org");
    // Forgotten by id, the other account on that server stays.
    expect(forgetRemote(h, band.id)).toBe(true);
    expect(readRemotes(h).map((r) => [r.as, r.active])).toEqual([
      ["me@example.org", true],
    ]);
  });

  it("derives a link's id from its host and account, whatever the path", () => {
    expect(linkId(A, "x@y")).toBe(linkId("wss://app.k7.rocks/other", "x@y"));
    expect(linkId(A, "x@y")).not.toBe(linkId(A, "z@y"));
    expect(linkId(A, "x@y")).toMatch(/^[0-9a-f]{10}$/);
  });

  it("forgets the active server, and the next saved one becomes active", () => {
    const h = home();
    writeRemote(h, pair(A));
    writeRemote(h, pair(B));
    expect(forgetRemote(h, B)).toBe(true);
    expect(readRemotes(h).map((r) => [r.url, r.active])).toEqual([[A, true]]);
    expect(forgetRemote(h)).toBe(true);
    expect(readRemotes(h)).toEqual([]);
  });
});

describe("the server a machine's engine is listed at", () => {
  it("names a relay's server as the origin the engine heartbeats to", () => {
    expect(originOfRelay(A)).toBe("https://app.k7.rocks");
    expect(originOfRelay("ws://127.0.0.1:8789/api/sync")).toBe(
      "http://127.0.0.1:8789",
    );
    expect(originOfRelay("not a url")).toBe("");
  });

  it("is each account's active server alone, with its token", () => {
    const root = home();
    const ann = join(root, "ann");
    const bob = join(root, "bob");
    mkdirSync(ann);
    mkdirSync(bob);
    writeRemote(ann, pair(A));
    writeRemote(ann, pair(B));
    writeRemote(bob, { ...pair(A), token: "bob" });
    writeFileSync(join(root, "a-file"), "");
    expect(
      pairedServers(root).sort((x, y) => x.token.localeCompare(y.token)),
    ).toEqual([
      { origin: "https://app.k7.rocks", token: "bob" },
      { origin: "https://k7.example.org", token: `t-${B}` },
    ]);
    setActiveRemote(ann, A);
    expect(pairedServers(root)).toContainEqual({
      origin: "https://app.k7.rocks",
      token: `t-${A}`,
    });
    expect(pairedServers(join(root, "none"))).toEqual([]);
  });

  it("follows a switch: off the server left, onto the active one with its token", () => {
    const h = home();
    writeRemote(h, pair(A));
    const before = readRemotes(h);
    writeRemote(h, pair(B));
    expect(engineMoves(before, readRemotes(h))).toEqual({
      forget: "https://app.k7.rocks",
      pair: { origin: "https://k7.example.org", token: `t-${B}` },
    });
    // Another account on the same server: the token changes, the server stays.
    const same = readRemotes(h);
    writeRemote(h, { ...pair(B), as: "band@x", token: "band" });
    expect(engineMoves(same, readRemotes(h))).toEqual({
      pair: { origin: "https://k7.example.org", token: "band" },
    });
    // The last one forgotten: the engine leaves, and is listed nowhere.
    const last = readRemotes(h);
    forgetRemote(h);
    expect(engineMoves(last, readRemotes(h))).toEqual({
      forget: "https://k7.example.org",
    });
    // An inactive one forgotten moves nothing.
    writeRemote(h, pair(A));
    writeRemote(h, pair(B));
    const two = readRemotes(h);
    forgetRemote(h, A);
    expect(engineMoves(two, readRemotes(h))).toEqual({});
  });
});

describe("where an account's service syncs", () => {
  const own = "ws://127.0.0.1:8789/api/sync";
  const link = (url: string, token: string, active: boolean, as = "u") => ({
    id: linkId(url, as),
    origin: originOfRelay(url),
    url,
    token,
    user: "u",
    as,
    active,
  });
  const remotes = [link(A, "a", true), link(B, "b", false)];

  it("is this hub's own relay when nothing is saved", () => {
    expect(syncTarget(own, [], true)).toEqual({ STUDIO_SYNC_URL: own });
    expect(syncTarget(own, [], false)).toEqual({ STUDIO_SYNC_URL: own });
  });

  it("on a machine, is the active server alone, the others named as hidden", () => {
    const env = syncTarget(own, remotes, true);
    expect(env.STUDIO_SYNC_URL).toBe(A);
    expect(env.STUDIO_SYNC_TOKEN).toBe("a");
    expect(JSON.parse(env.STUDIO_SYNC_SERVERS)).toEqual([
      {
        url: A,
        token: "a",
        main: true,
        id: linkId(A, "u"),
        as: "u",
        home: true,
      },
    ]);
    expect(JSON.parse(env.STUDIO_SYNC_HIDDEN)).toEqual([
      { id: linkId(B, "u"), url: B, home: true },
    ]);
    expect(
      syncTarget(own, [remotes[0]], true).STUDIO_SYNC_HIDDEN,
    ).toBeUndefined();
  });

  it("on a server, is its own relay whatever pairings its folder holds", () => {
    expect(syncTarget(own, remotes, false)).toEqual({ STUDIO_SYNC_URL: own });
  });

  it("marks, per server, the link a workspace recorded before accounts belongs to: the local account's own", () => {
    const other = link(A, "o", true, "other@x");
    const mine = link(A, "m", false);
    const env = syncTarget(own, [other, mine], true);
    expect(JSON.parse(env.STUDIO_SYNC_SERVERS)[0].home).toBeUndefined();
    expect(JSON.parse(env.STUDIO_SYNC_HIDDEN)).toEqual([
      { id: mine.id, url: A, home: true },
    ]);
    expect(env.STUDIO_SYNC_TOKEN).toBe("o");
  });
});
