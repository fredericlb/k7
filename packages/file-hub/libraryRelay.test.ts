// libraryRelay.test.ts — the hub as the server's replica of a library: a write to its folder reaches
// the library's room, which the relay files under LIBRARIES_ACCOUNT and nothing else.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("the libraries' relay", () => {
  it("relays a write to a library folder into the library's room, as LIBRARIES_ACCOUNT", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lib-relay-"));
    const home = join(tmp, "libraries");
    mkdirSync(join(home, "st0", "modules"), { recursive: true });
    writeFileSync(join(home, "st0", "modules", "mix.yaml"), "gain: 0.5\n");
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
    const relay = new LibraryRelay(home, url, "library-secret", () => {});
    const accounts: string[] = [];
    const stop = attachSyncRelay(server, {
      accountDir: (slug) => {
        accounts.push(slug);
        return slug === LIBRARIES_ACCOUNT ? home : join(tmp, slug);
      },
      accountOf: async (s) => (s === relay.secret ? LIBRARIES_ACCOUNT : null),
      log: () => {},
    });
    cleanup.push(() => {
      relay.stop();
      stop();
      server.close();
      server.closeAllConnections();
    });
    relay.follow([{ name: "st0" }]);
    const roomFile = join(home, ".sync-relay", "st0", "entries.jsonl");
    const entries = () =>
      existsSync(roomFile)
        ? readFileSync(roomFile, "utf8").split("\n").filter(Boolean).length
        : 0;
    await until(() => entries() >= 1);
    writeFileSync(join(home, "st0", "modules", "mix.yaml"), "gain: 0.9\n");
    await until(() => readFileSync(roomFile, "utf8").includes("0.9"));
    expect(accounts.every((a) => a === LIBRARIES_ACCOUNT)).toBe(true);
  });
});
