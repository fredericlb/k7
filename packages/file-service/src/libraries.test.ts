// libraries.test.ts — an admin writes the hub's folder of each library in place; anyone else reads it only.

import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountLibraryHome,
  isLibraryEditable,
  libraryRoot,
  setLibraryOverlays,
} from "@studio/song/sharedFolders";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { followAdmin, refreshLibraries } from "./libraries.ts";
import { Workspace } from "./workspace.ts";

const env = {
  home: process.env.STUDIO_LIBRARIES_HOME,
  hub: process.env.STUDIO_HUB_URL,
};
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "libs-"));
  mkdirSync(join(home, "k7-core"));
  mkdirSync(join(home, ".sync-replica"));
  process.env.STUDIO_LIBRARIES_HOME = home;
  delete process.env.STUDIO_HUB_URL;
});

afterEach(async () => {
  delete process.env.STUDIO_HUB_URL;
  await followAdmin(false);
  setLibraryOverlays([]);
  process.env.STUDIO_LIBRARIES_HOME = env.home;
  if (env.hub) process.env.STUDIO_HUB_URL = env.hub;
});

describe("followAdmin", () => {
  const versioned = () => {
    mkdirSync(join(home, "k7-core", "1"));
    mkdirSync(join(home, "k7-core", "draft"));
  };
  const draftWrite = () =>
    new Workspace(mkdtempSync(join(tmpdir(), "ws-"))).assertLibraryWritable(
      join(home, "k7-core", "draft", "modules", "x"),
    );

  it("opens the draft on the first request the hub stamps admin, with no open before it", async () => {
    versioned();
    expect(draftWrite).toThrow(/only the origin's admins/);
    await followAdmin(true);
    expect(draftWrite).not.toThrow();
  });

  it("keeps an admin's draft writable through a refresh that names nobody, the bench's", async () => {
    versioned();
    await followAdmin(true);
    await refreshLibraries();
    expect(isLibraryEditable("k7-core")).toBe(true);
    expect(draftWrite).not.toThrow();
  });

  it("follows an account that becomes an admin, and one that stops being one, without a restart", async () => {
    versioned();
    await followAdmin(false);
    expect(isLibraryEditable("k7-core")).toBe(false);
    await followAdmin(true);
    expect(isLibraryEditable("k7-core")).toBe(true);
    await followAdmin(false);
    expect(draftWrite).toThrow(/only the origin's admins/);
  });

  it("asks the hub for the drafts when the stamp makes it an admin, and only then", async () => {
    mkdirSync(join(home, "k7-core", "1"));
    const asked: unknown[] = [];
    const hub = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        const opts = JSON.parse(body) as { draft?: boolean };
        asked.push(opts);
        // What the hub's ensureDraft does: the newest version copied to draft/.
        if (opts.draft)
          mkdirSync(join(home, "k7-core", "draft"), { recursive: true });
        res.setHeader("content-type", "application/json");
        res.end('{"notes":[]}');
      });
    });
    await new Promise<void>((ok) => hub.listen(0, "127.0.0.1", ok));
    const { port } = hub.address() as AddressInfo;
    process.env.STUDIO_HUB_URL = `http://127.0.0.1:${port}`;
    try {
      await followAdmin(false);
      expect(asked).toEqual([]);
      await followAdmin(true);
      await followAdmin(true);
      expect(asked).toEqual([{ draft: true }]);
      expect(libraryRoot("k7-core")).toBe(join(home, "k7-core", "draft"));
      expect(draftWrite).not.toThrow();
    } finally {
      hub.close();
    }
  });
});

describe("refreshLibraries", () => {
  it("opens every library on disk for writing, in place, to an admin", async () => {
    await followAdmin(true);
    expect(isLibraryEditable("k7-core")).toBe(true);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core"));
  });

  it("opens a versioned library's DRAFT to an admin, and never one of its versions", async () => {
    mkdirSync(join(home, "k7-core", "1"));
    mkdirSync(join(home, "k7-core", "draft"));
    await followAdmin(true);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core", "draft"));
    const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
    expect(() =>
      ws.assertLibraryWritable(join(home, "k7-core", "1", "modules", "x")),
    ).toThrow(/published version never changes/);
    expect(() =>
      ws.assertLibraryWritable(join(home, "k7-core", "draft", "modules", "x")),
    ).not.toThrow();
  });

  it("answers the ACCOUNT's library at _libraries/account, its own to write, never outside it", () => {
    const studioHome0 = process.env.STUDIO_HOME;
    process.env.STUDIO_HOME = mkdtempSync(join(tmpdir(), "acct-"));
    try {
      const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
      const at = ws.mediaPath("_libraries/account/modules/audio/x");
      expect(at).toBe(join(accountLibraryHome(), "modules", "audio", "x"));
      expect(() => ws.assertLibraryWritable(at)).not.toThrow();
      expect(() => ws.mediaPath("_libraries/account/../../etc")).toThrow();
    } finally {
      if (studioHome0 === undefined) delete process.env.STUDIO_HOME;
      else process.env.STUDIO_HOME = studioHome0;
    }
  });

  it("answers no path below _libraries/ that names no library, to read or to write", () => {
    mkdirSync(join(home, ".sync-relay", "k7-core"), { recursive: true });
    const ws = new Workspace(mkdtempSync(join(tmpdir(), "ws-")));
    for (const rel of [
      "_libraries/.sync-relay/k7-core/entries.jsonl",
      "_libraries/.sync-replica/x",
      "_libraries/../x",
      "_libraries/Not A Name/x",
    ]) {
      expect(() => ws.read(rel), rel).toThrow(/names no library/);
      expect(() => ws.write(rel, "{}"), rel).toThrow(/names no library/);
    }
    expect(ws.mediaPath("_libraries")).toBe(home);
    expect(ws.mediaPath("_libraries/k7-core/x")).toBe(
      join(home, "k7-core", "x"),
    );
  });

  it("leaves them read-only to anyone else", async () => {
    await followAdmin(true);
    await followAdmin(false);
    expect(isLibraryEditable("k7-core")).toBe(false);
    expect(libraryRoot("k7-core")).toBe(join(home, "k7-core"));
  });
});
