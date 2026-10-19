// The bundle's `k7-core` library is the newest PUBLISHED version this build runs, manifest included —
// never one that needs a higher level — and the repo's folder only when the origin cannot answer.

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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const repo = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const env = process.env.STUDIO_LIBRARY_ORIGIN;
let server: Server;
let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "lib-archive-"));
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
  it("bundles the newest version this build runs, with its manifest", async () => {
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(readFileSync(join(dest, "mix.k7x"), "utf8")).toBe('plugin("two")\n');
    expect(
      parseLibraryManifest(readFileSync(join(dest, LIBRARY_MANIFEST), "utf8"))
        ?.version,
    ).toBe(2);
  });

  it("falls back to the repo's folder, with no manifest, when the origin cannot answer", async () => {
    process.env.STUDIO_LIBRARY_ORIGIN = "http://127.0.0.1:9";
    const dest = join(tmp, "bundle", "k7-core");
    await bundleLibrary(repo, dest);
    expect(existsSync(join(dest, "modules"))).toBe(true);
    expect(existsSync(join(dest, LIBRARY_MANIFEST))).toBe(false);
  });
});
