// blobSync.test.ts — binary files between replicas over a real relay and a real blob store on one server:
// a take written, then replaced; a seed carrying audio; a machine joining with audio of its own; a lost blob put back.

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { LiveCapture } from "@studio/file-service/src/liveCapture.ts";
import { ConfirmedDir } from "@studio/file-service/src/liveConfirmed.ts";
import {
  loadHead,
  type RelayAuth,
  RelayLink,
} from "@studio/file-service/src/liveRelay.ts";
import { isBinary, skip } from "@studio/file-service/src/workspaceFilter.ts";
import { Replica } from "@studio/live-sync/replica";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { blobsRouter } from "./blobStore.ts";
import { DeviceTokens } from "./deviceTokens.ts";
import { attachSyncRelay, SYNC_PATH } from "./syncRelay.ts";

const SECRETS = new Set(["secret-a", "secret-b"]);
const MIX = "plugin: mixer\nparams:\n  gain: 0.5\n";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.splice(0).reverse()) f();
});

function put(root: string, rel: string, data: string | Buffer): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), data);
}

const bytesAt = (root: string, rel: string): Buffer | null => {
  try {
    return readFileSync(join(root, rel));
  } catch {
    return null;
  }
};

async function until(f: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The relay and the blob store on one HTTP server, as k7's backend mounts them. */
async function hub() {
  const dataRoot = mkdtempSync(join(tmpdir(), "blobsync-data-"));
  const tokens = new DeviceTokens(Buffer.from("test-key"), (slug) =>
    join(dataRoot, slug),
  );
  const accountOf = async (c: { secret?: string; token?: string }) =>
    c.token
      ? (tokens.verify(c.token)?.slug ?? null)
      : SECRETS.has(c.secret ?? "")
        ? "acct"
        : null;
  const app = express();
  app.use(
    "/api/sync/blobs",
    blobsRouter({ accountDir: (slug) => join(dataRoot, slug), accountOf }),
  );
  const server: Server = createServer(app);
  const stop = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: (s) => accountOf({ secret: s }),
    deviceOf: (t) => tokens.verify(t)?.slug ?? null,
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  cleanup.push(() => {
    stop();
    server.close();
    server.closeAllConnections();
  });
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
  return { url, tokens, dataRoot };
}

/** A workspace wired as liveSync.ts wires it, blob cache and fetches included. */
function device(
  url: string,
  auth: RelayAuth,
  files: Record<string, string | Buffer>,
  again?: { root: string; logDir: string },
) {
  const root = again?.root ?? mkdtempSync(join(tmpdir(), "blobsync-dev-"));
  const logDir = again?.logDir ?? mkdtempSync(join(tmpdir(), "blobsync-log-"));
  for (const [rel, data] of Object.entries(files)) put(root, rel, data);
  const link = new RelayLink(url, auth, () => {});
  const capture = new LiveCapture({
    root,
    replica: JSON.stringify(auth),
    skip,
    isBinary,
    onBatch: (b) => link.local("band", b),
    quietMs: 30,
    reconcileMs: 0,
    binarySettleMs: 50,
    blobDir: join(logDir, "blobs"),
    onMissingBlob: (blob) => link.fetch("band", blob),
  });
  const written: string[] = [];
  const confirmed = new ConfirmedDir(join(logDir, "confirmed"));
  const replica = new Replica(
    JSON.stringify(auth),
    {
      read: (f) => capture.read(f),
      write: (f, t) => {
        written.push(f);
        capture.writeKnown(f, t);
      },
    },
    confirmed,
    loadHead(logDir),
  );
  link.add(
    { name: "band", capture, replica, written, onRemote: () => {} },
    logDir,
  );
  capture.start(replica.head > 0 ? confirmed : undefined);
  const stop = () => {
    link.close();
    capture.stop();
  };
  cleanup.push(stop);
  return { root, logDir, replica, stop };
}

const same = (root: string, rel: string, want: Buffer) => () =>
  bytesAt(root, rel)?.equals(want) ?? false;

describe("binary files over k7fs", () => {
  it("brings a take written on one machine to another, then its replacement", async () => {
    const { url } = await hub();
    const a = device(url, { secret: "secret-a" }, { "mix.yaml": MIX });
    await until(() => a.replica.head === 1);
    const b = device(url, { secret: "secret-b" }, {});
    await until(() => bytesAt(b.root, "mix.yaml")?.toString() === MIX);

    const take = randomBytes(200_000);
    put(a.root, "song.k7/takes/take.wav", take);
    await until(same(b.root, "song.k7/takes/take.wav", take));

    const again = randomBytes(150_000);
    put(a.root, "song.k7/takes/take.wav", again);
    await until(same(b.root, "song.k7/takes/take.wav", again));
    expect(bytesAt(a.root, "song.k7/takes/take.wav")?.equals(again)).toBe(true);
  }, 30_000);

  it("seeds a room with audio, and a newcomer gets the bytes", async () => {
    const { url } = await hub();
    const preset = Buffer.concat([Buffer.from("CcnK"), randomBytes(5000)]);
    const amp = randomBytes(80_000);
    const a = device(
      url,
      { secret: "secret-a" },
      { "mix.yaml": MIX, "presets/lead.fxp": preset, "irs/room.wav": amp },
    );
    await until(() => a.replica.head === 1);
    const b = device(url, { secret: "secret-b" }, {});
    await until(same(b.root, "presets/lead.fxp", preset));
    await until(same(b.root, "irs/room.wav", amp));
  }, 30_000);

  it("lets a machine join with audio of its own: sent to the room, and to the others", async () => {
    const { url, tokens } = await hub();
    const server = device(url, { secret: "secret-a" }, { "mix.yaml": MIX });
    await until(() => server.replica.head === 1);
    const mine = randomBytes(60_000);
    const { token } = tokens.mint("acct", "laptop");
    device(url, { token }, { "takes/mine.wav": mine });
    await until(same(server.root, "takes/mine.wav", mine));
  }, 30_000);

  it("puts back on the store, at its next connect, a blob the room names and the store lost", async () => {
    const { url, dataRoot } = await hub();
    const amp = randomBytes(60_000);
    const a = device(
      url,
      { secret: "secret-a" },
      { "mix.yaml": MIX, "irs/room.wav": amp },
    );
    await until(() => a.replica.head === 1);
    const store = join(dataRoot, "acct", ".sync-blobs");
    await until(() => existsSync(store) && readdirSync(store).length > 0);
    rmSync(store, { recursive: true, force: true });

    a.stop();
    device(url, { secret: "secret-a" }, {}, { root: a.root, logDir: a.logDir });
    const b = device(url, { secret: "secret-b" }, {});
    await until(same(b.root, "irs/room.wav", amp));
  }, 30_000);
});
