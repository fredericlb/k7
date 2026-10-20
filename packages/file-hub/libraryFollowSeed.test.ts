// The seed loop of a paired machine, end to end: an origin publishing version 1 only, a machine whose
// library follows it read-only and whose bundled seed declares version 2. The follow undoes any file the
// room lacks, so a hub that wrote the seed into the followed folder found it gone and added it again,
// on every ensure. See docs/fileHub.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, expect, it } from "vitest";
import { blobsRouter } from "./blobStore.ts";
import { LibraryStore } from "./libraries.ts";
import { LIBRARIES_ACCOUNT, LibraryRelay } from "./libraryRelay.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0)) f();
});

async function until(f: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const MANIFEST_1 = 'name("k7-core")\nversion(1)\nrequires(1)\n';

it("adds no seed version into a library that follows its origin, however often it is ensured", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lib-follow-seed-"));
  const originHome = join(tmp, "origin", "libraries");
  const v1 = join(originHome, "k7-core", "1");
  mkdirSync(join(v1, "modules"), { recursive: true });
  writeFileSync(join(v1, "library.k7x"), MANIFEST_1);
  writeFileSync(join(v1, "modules", "mix.k7x"), 'plugin("v1")\n');
  const app = express();
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
  const origin = new LibraryRelay(originHome, url, "library-secret", () => {});
  const accountDir = (slug: string) =>
    slug === LIBRARIES_ACCOUNT ? originHome : join(tmp, "origin", slug);
  app.use(
    "/api/sync/blobs",
    blobsRouter({
      accountDir,
      accountOf: async (c) =>
        c.secret === origin.secret
          ? LIBRARIES_ACCOUNT
          : c.token === "device"
            ? "fred-0123456789"
            : null,
      sweepEveryMs: 0,
    }),
  );
  const stop = attachSyncRelay(server, {
    accountDir,
    accountOf: async (s) => (s === origin.secret ? LIBRARIES_ACCOUNT : null),
    deviceOf: (t) => (t === "device" ? "fred-0123456789" : null),
    sharedAccount: LIBRARIES_ACCOUNT,
    log: () => {},
  });
  // The machine's bundle: the repo's k7-core, declaring version 2.
  const seed = join(tmp, "seed", "k7-core");
  mkdirSync(join(seed, "modules"), { recursive: true });
  mkdirSync(join(seed, "samples"), { recursive: true });
  writeFileSync(join(seed, "modules", "mix.k7x"), 'plugin("v2")\n');
  writeFileSync(join(seed, "samples", ".gitkeep"), "");
  writeFileSync(
    join(seed, "library.k7x"),
    'name("k7-core")\nversion(2)\nrequires(1)\nnotes("fixed")\n',
  );
  const data = join(tmp, "machine");
  const home = join(data, "libraries");
  const machine = new LibraryRelay(home, "ws://unused", "other", () => {});
  const store = new LibraryStore(
    data,
    `k7-core=${seed}`,
    () => machine.following,
  );
  cleanup.push(() => {
    machine.stop();
    origin.stop();
    stop();
    server.close();
    server.closeAllConnections();
  });
  origin.follow([{ name: "k7-core" }]);
  machine.followRemote(url, "device");
  machine.follow([{ name: "k7-core" }]);
  const mix = join(home, "k7-core", "1", "modules", "mix.k7x");
  await until(
    () => existsSync(mix) && readFileSync(mix, "utf8") === 'plugin("v1")\n',
  );

  // Each library list the e2e pages ask for ensures the folders: none may add a version.
  for (let i = 0; i < 3; i++) {
    expect(await store.ensure()).toMatchObject([
      { name: "k7-core", state: "current" },
    ]);
    await new Promise((r) => setTimeout(r, 300));
  }
  expect(readdirSync(join(home, "k7-core"))).toEqual(["1"]);
  expect(store.versions("k7-core").map((m) => m.version)).toEqual([1]);
}, 20_000);
