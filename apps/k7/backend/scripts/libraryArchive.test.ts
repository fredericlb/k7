// The bundle's `k7-core` library is the newest version this build runs, manifest included — never one
// that needs a higher level: the origin's published one, or the repo's when it declares a higher number
// or the origin cannot answer. The repo here is a fake one, so the real `k7-core`'s number moves nothing.

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
import {
  LibraryStore,
  PUBLIC_LIBRARIES_PATH,
  PublicLibraries,
} from "@studio/file-hub";
import {
  LIBRARY_MANIFEST,
  parseLibraryManifest,
  stringifyLibraryManifest,
} from "@studio/song-schema/libraryVersions";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleLibrary } from "./libraryArchive.mjs";

const env = process.env.STUDIO_LIBRARY_ORIGIN;
let server: Server;
let tmp: string;
let repo: string;

/** The fake repo's `k7-core`, declaring `version` (or nothing) at level 1. */
function repoLibrary(version?: number) {
  if (version)
    writeFileSync(
      join(repo, "k7-core", LIBRARY_MANIFEST),
      stringifyLibraryManifest({ name: "k7-core", version, requires: 1 }),
    );
}

const bundled = (dest: string) => ({
  mix: readFileSync(join(dest, "mix.k7x"), "utf8"),
  version: existsSync(join(dest, LIBRARY_MANIFEST))
    ? parseLibraryManifest(readFileSync(join(dest, LIBRARY_MANIFEST), "utf8"))
        ?.version
    : undefined,
});

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "lib-archive-"));
  repo = join(tmp, "repo");
  mkdirSync(join(repo, "packages", "song-schema", "src"), { recursive: true });
  writeFileSync(
    join(repo, "packages", "song-schema", "src", "libraryVersions.ts"),
    "export const LIBRARY_LEVEL = 1;\n",
  );
  mkdirSync(join(repo, "k7-core"), { recursive: true });
  writeFileSync(join(repo, "k7-core", "mix.k7x"), 'plugin("repo")\n');
  const seed = join(tmp, "seed");
  mkdirSync(join(seed, "k7-core"), { recursive: true });
  writeFileSync(join(seed, "k7-core", "mix.k7x"), 'plugin("one")\n');
  const store = new LibraryStore(join(tmp, "origin"), seed);
  await store.ensure({ draft: true });
  writeFileSync(
    join(store.home, "k7-core", "draft", "mix.k7x"),
    'plugin("two")\n',
  );
  await store.publish("k7-core");
  // A third version this build cannot run: the bundle must stop at 2.
  writeFileSync(
    join(store.home, "k7-core", "draft", "mix.k7x"),
    'plugin("three")\n',
  );
  const three = await store.publish("k7-core");
  if ("ok" in three)
    writeFileSync(
      join(store.home, "k7-core", "3", LIBRARY_MANIFEST),
      stringifyLibraryManifest({ name: "k7-core", version: 3, requires: 999 }),
    );
  const app = express();
  app.use(PUBLIC_LIBRARIES_PATH, new PublicLibraries(store).handler);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  process.env.STUDIO_LIBRARY_ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.close();
  if (env === undefined) delete process.env.STUDIO_LIBRARY_ORIGIN;
  else process.env.STUDIO_LIBRARY_ORIGIN = env;
});

describe("bundleLibrary", () => {
  it("bundles the origin's newest version this build runs, with its manifest, when the repo's is no newer", async () => {
    repoLibrary(2);
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(bundled(dest)).toEqual({ mix: 'plugin("two")\n', version: 2 });
  });

  it("bundles the repo's folder when its manifest declares a number the origin has not published", async () => {
    repoLibrary(5);
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(bundled(dest)).toEqual({ mix: 'plugin("repo")\n', version: 5 });
  });

  it("falls back to the repo's folder, its manifest with it, when the origin cannot answer", async () => {
    repoLibrary(2);
    process.env.STUDIO_LIBRARY_ORIGIN = "http://127.0.0.1:9";
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(bundled(dest)).toEqual({ mix: 'plugin("repo")\n', version: 2 });
  });

  it("falls back to a bare folder, which installs as version 1, when the repo declares no version", async () => {
    process.env.STUDIO_LIBRARY_ORIGIN = "http://127.0.0.1:9";
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(bundled(dest)).toEqual({
      mix: 'plugin("repo")\n',
      version: undefined,
    });
  });
});
