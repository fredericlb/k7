// syncReady.test.ts — what a device's link says about being up to date, over a real relay and blob store:
// connecting until welcomed, current once caught up, its audio listed as pending until the bytes land,
// and offline once the relay goes away. What `/sync/project` and `/open` read (file-service docs/liveCapture.md).

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

async function until(f: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The relay and the blob store on one server, its downloads held while `held` is true. */
async function hub() {
  const dataRoot = mkdtempSync(join(tmpdir(), "syncready-data-"));
  const accountOf = async (c: { secret?: string }) =>
    SECRETS.has(c.secret ?? "") ? "acct" : null;
  const gate = { held: false, waiting: [] as (() => void)[] };
  const app = express();
  app.use("/api/sync/blobs", (req, _res, next) => {
    if (req.method === "GET" && gate.held) gate.waiting.push(next);
    else next();
  });
  app.use(
    "/api/sync/blobs",
    blobsRouter({ accountDir: (slug) => join(dataRoot, slug), accountOf }),
  );
  const server: Server = createServer(app);
  const stop = attachSyncRelay(server, {
    accountDir: (slug) => join(dataRoot, slug),
    accountOf: (s) => accountOf({ secret: s }),
    deviceOf: () => null,
    log: () => {},
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const shut = () => {
    stop();
    server.close();
    server.closeAllConnections();
  };
  cleanup.push(shut);
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${SYNC_PATH}`;
  const release = () => {
    gate.held = false;
    for (const next of gate.waiting.splice(0)) next();
  };
  return { url, gate, release, shut };
}

/** A workspace wired as liveSync.ts wires it, its link and capture handed back. */
function device(
  url: string,
  auth: RelayAuth,
  files: Record<string, string | Buffer>,
) {
  const root = mkdtempSync(join(tmpdir(), "syncready-dev-"));
  const logDir = mkdtempSync(join(tmpdir(), "syncready-log-"));
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
  const replica = new Replica(
    JSON.stringify(auth),
    {
      read: (f) => capture.read(f),
      write: (f, t) => {
        written.push(f);
        capture.writeKnown(f, t);
      },
    },
    new ConfirmedDir(join(logDir, "confirmed")),
    loadHead(logDir),
  );
  link.add(
    { name: "band", capture, replica, written, onRemote: () => {} },
    logDir,
  );
  capture.start();
  cleanup.push(() => {
    link.close();
    capture.stop();
  });
  const pending = () => Object.keys(capture.blobs?.pending() ?? {});
  return { root, link, replica, pending };
}

describe("a device's link, up to date or not", () => {
  it("is current only once welcomed, and lists the audio still on its way until it lands", async () => {
    const { url, gate, release } = await hub();
    const take = randomBytes(120_000);
    const a = device(
      url,
      { secret: "secret-a" },
      { "mix.yaml": MIX, "song.k7/clips/take.wav": take },
    );
    await until(() => a.link.textState("band") === "current");
    await until(() => a.replica.head === 1);

    gate.held = true;
    const b = device(url, { secret: "secret-b" }, {});
    // The text arrives first; the take is known and its bytes held back.
    await until(() => b.link.textState("band") === "current");
    await until(() => b.pending().includes("song.k7/clips/take.wav"));

    release();
    await until(() => b.pending().length === 0);
    expect(readFileSync(join(b.root, "song.k7/clips/take.wav"))).toEqual(take);
  }, 30_000);

  it("reads as offline once the relay is gone, the copy here being all there is", async () => {
    const { url, shut } = await hub();
    const a = device(url, { secret: "secret-a" }, { "mix.yaml": MIX });
    await until(() => a.replica.head === 1);
    await until(() => a.link.textState("band") === "current");
    shut();
    await until(() => a.link.textState("band") === "offline");
  }, 30_000);
});
