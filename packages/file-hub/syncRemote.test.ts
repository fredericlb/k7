// syncRemote.test.ts — an account's pairings: one MAIN server and others beside it, the file from before
// secondaries read as the main one, and making another main or forgetting one. See docs/syncRelay.md.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  forgetRemote,
  readRemote,
  readRemotes,
  setMainRemote,
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
      { url: A, token: "t", user: "me@example.org", main: true },
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
    expect(readRemotes(h)).toEqual([{ ...pair(A, true), token: "fresh" }]);
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
