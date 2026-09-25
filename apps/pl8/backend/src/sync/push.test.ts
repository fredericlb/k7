// push.test.ts — pl8's half of a sync over a REAL tunnel: the start answers with the machine's
// first report, the reports after it keep the run this side up to date until it is done, and the
// target listing is the machine's own. The machine here is a stand-in; its half is
// packages/engine-host/src/machineSync.test.ts.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SyncDeps,
  SyncError,
  startSyncOn,
  syncStatus,
  targetsOn,
} from "./push.ts";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("a sync driven from pl8", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let deps: SyncDeps;
  let asked: Record<string, unknown>[];

  beforeEach(async () => {
    asked = [];
    server = createServer();
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const library = mkdtempSync(join(tmpdir(), "push-lib-"));
    agent = new TunnelAgent({
      registryUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      id: "e1",
      token: "t",
      enginePort: 1,
      cacheDir: mkdtempSync(join(tmpdir(), "push-cache-")),
      log: () => {},
      jobs: {
        "sync-targets": (_req, emit) =>
          emit({
            type: "sync-targets",
            targets: [{ name: "stick", uri: "file:///x" }],
          }),
        async sync(req, emit) {
          asked.push(req);
          const job = {
            id: String(req.id),
            done: false,
            phase: "connecting",
            copied: 0,
          };
          emit({ type: "sync-job", job });
          await new Promise((r) => setTimeout(r, 30));
          emit({
            type: "sync-job",
            job: { ...job, done: true, phase: "done", copied: 1 },
          });
        },
      },
    });
    agent.start();
    await until(() => hub.has("e1"));
    deps = {
      jobsChannel: (id, roots) => hub.openReady(id, roots, 5000, "jobs"),
      mediatekRoot: library,
    };
  });

  afterEach(async () => {
    agent.stop();
    hub.stop();
    await new Promise((r) => server.close(r));
  });

  it("answers with the first report, and keeps the run current until it is done", async () => {
    const job = await startSyncOn({
      deps,
      engineId: "e1",
      target: "stick",
      playlist: "gig",
      tracks: [
        {
          path: "songs/a/original.mp3",
          artist: "A",
          album: "Al",
          title: "One",
        },
      ],
    });
    expect(job).toMatchObject({ done: false, phase: "connecting" });
    await until(() => !!syncStatus(job.id)?.done);
    expect(syncStatus(job.id)).toMatchObject({ copied: 1, phase: "done" });
    expect(asked[0]).toMatchObject({ target: "stick", playlist: "gig" });
  });

  it("lists the machine's own targets", async () => {
    expect(await targetsOn(deps, "e1")).toEqual({
      targets: [{ name: "stick", uri: "file:///x" }],
    });
  });

  it("refuses an engine with no tunnel, by name", async () => {
    await expect(targetsOn(deps, "nobody")).rejects.toThrow(SyncError);
  });
});
