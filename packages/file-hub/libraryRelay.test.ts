// libraryRelay.test.ts — the hub as the server's replica of a library: a write to its folder reaches
// the library's room, which the relay files under LIBRARIES_ACCOUNT and nothing else; and a paired
// machine's hub following that room read-only, a local edit undone and never sent.

import { randomBytes } from "node:crypto";
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
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { blobsRouter } from "./blobStore.ts";
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
    mkdirSync(join(home, "k7-core", "modules"), { recursive: true });
    writeFileSync(join(home, "k7-core", "modules", "mix.yaml"), "gain: 0.5\n");
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
      deviceOf: (t) => (t === "device" ? "fred-0123456789" : null),
      sharedAccount: LIBRARIES_ACCOUNT,
      log: () => {},
    });
    cleanup.push(() => {
      relay.stop();
      stop();
      server.close();
      server.closeAllConnections();
    });
    relay.follow([{ name: "k7-core" }]);
    const roomFile = join(home, ".sync-relay", "k7-core", "entries.jsonl");
    const entries = () =>
      existsSync(roomFile)
        ? readFileSync(roomFile, "utf8").split("\n").filter(Boolean).length
        : 0;
    await until(() => entries() >= 1);
    writeFileSync(join(home, "k7-core", "modules", "mix.yaml"), "gain: 0.9\n");
    await until(() => readFileSync(roomFile, "utf8").includes("0.9"));
    expect(accounts.every((a) => a === LIBRARIES_ACCOUNT)).toBe(true);

    // Any replica follows it as `@lib/k7-core`, and is refused a write.
    const ws = new WebSocket(url, {
      headers: { authorization: "Bearer device" },
    });
    const got: {
      t: string;
      mode?: string;
      error?: string;
      workspace?: string;
      files?: Record<string, string>;
    }[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    await new Promise((r) => ws.on("open", r));
    ws.send(
      JSON.stringify({ t: "hello", workspace: "@lib/k7-core", since: 0 }),
    );
    await until(() => got.some((m) => m.t === "welcome"));
    const welcome = got.find((m) => m.t === "welcome");
    expect(welcome).toMatchObject({
      workspace: "@lib/k7-core",
      mode: "snapshot",
    });
    expect(welcome?.files?.["modules/mix.yaml"]).toContain("0.9");
    ws.send(
      JSON.stringify({
        t: "batch",
        workspace: "@lib/k7-core",
        batch: {
          id: "x",
          replica: "d",
          local: 1,
          ts: 0,
          label: "edit",
          ops: [],
        },
      }),
    );
    await until(() => got.some((m) => m.t === "error"));
    expect(got.find((m) => m.t === "error")?.error).toMatch(
      /followed, never written/,
    );
    ws.close();
  });

  it("follows the origin's library read-only on a paired machine: a local edit is undone, nothing is sent", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lib-follow-"));
    const originHome = join(tmp, "origin", "libraries");
    mkdirSync(join(originHome, "k7-core", "modules"), { recursive: true });
    mkdirSync(join(originHome, "k7-core", "samples"), { recursive: true });
    writeFileSync(
      join(originHome, "k7-core", "modules", "mix.yaml"),
      "gain: 0.5\n",
    );
    // A library binary: it reaches the machine from the libraries' blob store, read with the device's token.
    const kick = randomBytes(64 * 1024);
    writeFileSync(join(originHome, "k7-core", "samples", "kick.wav"), kick);
    const app = express();
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
    const origin = new LibraryRelay(
      originHome,
      url,
      "library-secret",
      () => {},
    );
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
    // The machine's bundled copy is stale, and holds a file the origin does not.
    const home = join(tmp, "machine", "libraries");
    mkdirSync(join(home, "k7-core", "modules"), { recursive: true });
    writeFileSync(join(home, "k7-core", "modules", "mix.yaml"), "gain: 0.1\n");
    writeFileSync(join(home, "k7-core", "modules", "old.yaml"), "x: 1\n");
    const machine = new LibraryRelay(home, "ws://unused", "other", () => {});
    cleanup.push(() => {
      machine.stop();
      origin.stop();
      stop();
      server.close();
      server.closeAllConnections();
    });
    origin.follow([{ name: "k7-core" }]);
    const roomFile = join(
      originHome,
      ".sync-relay",
      "k7-core",
      "entries.jsonl",
    );
    const room = () =>
      existsSync(roomFile) ? readFileSync(roomFile, "utf8") : "";
    await until(() => room().includes("0.5"));

    machine.followRemote(url, "device");
    machine.follow([{ name: "k7-core" }]);
    const mix = join(home, "k7-core", "modules", "mix.yaml");
    const text = () => (existsSync(mix) ? readFileSync(mix, "utf8") : "");
    await until(() => text() === "gain: 0.5\n");
    expect(existsSync(join(home, "k7-core", "modules", "old.yaml"))).toBe(
      false,
    );
    const machineKick = join(home, "k7-core", "samples", "kick.wav");
    await until(
      () => existsSync(machineKick) && readFileSync(machineKick).equals(kick),
      10_000,
    );

    // The origin's edit reaches the machine.
    writeFileSync(
      join(originHome, "k7-core", "modules", "mix.yaml"),
      "gain: 0.7\n",
    );
    await until(() => text() === "gain: 0.7\n");

    // The machine's edit is put back, and the room never hears of it.
    const before = room();
    writeFileSync(mix, "gain: 0.99\n");
    await until(() => text() === "gain: 0.7\n");
    await new Promise((r) => setTimeout(r, 300));
    expect(room()).toBe(before);
    expect(room()).not.toContain("0.99");
  });
});
