// An unpaired machine brings a published version down from the origin's public listing: the files
// arrive checked, one it already holds is copied rather than downloaded, the draft is never served,
// and no path leaves the version.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LibraryStore } from "./libraries.ts";
import { fetchLibraryVersion, PUBLIC_LIBRARIES_PATH } from "./libraryFetch.ts";
import { PublicLibraries } from "./publicLibraries.ts";

let origin: LibraryStore;
let desk: string;
let server: Server;
let url: string;
let served: string[];

beforeEach(async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lib-fetch-"));
  const seed = join(tmp, "seed");
  mkdirSync(join(seed, "st0", "irs"), { recursive: true });
  writeFileSync(join(seed, "st0", "irs", "room.wav"), "RIFF-room");
  writeFileSync(join(seed, "st0", "mix.yaml"), "plugin: old\n");
  origin = new LibraryStore(join(tmp, "origin"), seed);
  origin.ensure({ draft: true });
  writeFileSync(join(origin.home, "st0", "draft", "mix.yaml"), "plugin: new\n");
  origin.publish("st0");
  desk = join(tmp, "desk");
  mkdirSync(join(desk, "st0"), { recursive: true });
  // The desk already holds version 1: its seed.
  const one = join(desk, "st0", "1");
  mkdirSync(join(one, "irs"), { recursive: true });
  writeFileSync(join(one, "irs", "room.wav"), "RIFF-room");
  served = [];
  const app = express();
  app.use(PUBLIC_LIBRARIES_PATH, (req, _res, next) => {
    if (req.path.endsWith("/file")) served.push(String(req.query.path));
    next();
  });
  app.use(PUBLIC_LIBRARIES_PATH, new PublicLibraries(origin).handler);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
});

describe("fetchLibraryVersion", () => {
  it("brings version 2 down, copying the file it already holds and downloading the rest", async () => {
    expect(await fetchLibraryVersion(desk, "st0", 2, url)).toBeNull();
    expect(readFileSync(join(desk, "st0", "2", "mix.yaml"), "utf8")).toBe(
      "plugin: new\n",
    );
    expect(
      readFileSync(join(desk, "st0", "2", "irs", "room.wav"), "utf8"),
    ).toBe("RIFF-room");
    expect(served.sort()).toEqual(["library.yaml", "mix.yaml"]);
  });

  it("says why when the origin has no such version, and leaves nothing behind", async () => {
    expect(await fetchLibraryVersion(desk, "st0", 7, url)).toMatch(
      /has no st0 7/,
    );
    expect(existsSync(join(desk, "st0", "7"))).toBe(false);
  });

  it("serves no draft and no path outside a version", async () => {
    expect(
      (await fetch(`${url}${PUBLIC_LIBRARIES_PATH}/st0/draft`)).status,
    ).toBe(404);
    const out = await fetch(
      `${url}${PUBLIC_LIBRARIES_PATH}/st0/2/file?path=${encodeURIComponent("../draft/mix.yaml")}`,
    );
    expect(out.status).toBe(404);
  });
});
