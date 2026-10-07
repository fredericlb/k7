// engineSync.test.ts — a document is held until the machine has its files, the latest one wins, a
// copied file is not asked for twice, and a machine that does not know `sync` is not waited on.

import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { setBoundJobsUrl } from "./boundMachine.ts";
import {
  engineSyncState,
  forgetSyncFailure,
  isHeldBack,
  sendWhenSynced,
} from "./engineSync.ts";

type Answer = (
  req: { id: string; files: string[] },
  send: (r: object) => void,
) => void;

let wss: WebSocketServer | null = null;
const asked: string[][] = [];

async function machine(answer: Answer): Promise<void> {
  const server = new WebSocketServer({ port: 0 });
  wss = server;
  await new Promise((r) => server.once("listening", r));
  server.on("connection", (sock) =>
    sock.on("message", (data) => {
      const req = JSON.parse(data.toString());
      asked.push(req.files);
      answer(req, (r) => sock.send(JSON.stringify({ id: req.id, ...r })));
    }),
  );
  setBoundJobsUrl(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
}

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 200 && !ok(); i++)
    await new Promise((r) => setTimeout(r, 5));
};

afterEach(() => {
  wss?.close();
  wss = null;
  asked.length = 0;
  setBoundJobsUrl(null);
});

function aSong(): string {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const kick = join(dir, "kick.wav");
  writeFileSync(kick, "RIFF-kick");
  return kick;
}

describe("sendWhenSynced", () => {
  it("sends at once with no machine bound", () => {
    const sent: unknown[] = [];
    sendWhenSynced(
      "s0",
      { clip: aSong() },
      () => [],
      (d) => sent.push(d),
    );
    expect(sent).toHaveLength(1);
  });

  it("takes no inline source for a path, even one opening on `//`", async () => {
    await machine((_req, send) => send({ type: "synced", failed: 0 }));
    const faustDsp = `// dsp.dsp — a header\n${"x".repeat(5000)}\n`;
    const sent: unknown[] = [];
    sendWhenSynced(
      "s5",
      { faustDsp, one: `/${"y".repeat(5000)}` },
      () => [],
      (d) => sent.push(d),
    );
    expect(sent).toHaveLength(1);
    expect(asked).toEqual([]);
  });

  it("holds the document until the copy ends, sends the latest, and never asks twice", async () => {
    let finish = (): void => {};
    await machine((_req, send) => {
      send({ type: "syncing", files: 1, filesDone: 0, bytes: 9, bytesDone: 0 });
      finish = () => send({ type: "synced", failed: 0 });
    });
    const kick = aSong();
    const sent: { v: number }[] = [];
    sendWhenSynced(
      "s1",
      { clip: kick, v: 1 },
      () => [],
      (d) => sent.push(d),
    );
    await until(() => asked.length === 1);
    await until(() => engineSyncState("s1")?.bytes === 9);
    expect(sent).toEqual([]);
    expect(engineSyncState("s1")).toMatchObject({ files: 1, filesDone: 0 });
    sendWhenSynced(
      "s1",
      { clip: kick, v: 2 },
      () => [],
      (d) => sent.push(d),
    );
    finish();
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ clip: kick, v: 2 }]);
    expect(engineSyncState("s1")).toBeNull();
    sendWhenSynced(
      "s1",
      { clip: kick, v: 3 },
      () => [],
      (d) => sent.push(d),
    );
    expect(sent.at(-1)).toEqual({ clip: kick, v: 3 });
    expect(asked).toEqual([[kick]]);
  });

  it("holds everything back after a failed copy, until the person retries", async () => {
    let fail = true;
    await machine((_req, send) =>
      send(
        fail
          ? { type: "synced", failed: 1, failures: ["kick.wav — in use"] }
          : { type: "synced", failed: 0, failures: [] },
      ),
    );
    const kick = aSong();
    const sent: unknown[] = [];
    sendWhenSynced(
      "s3",
      { clip: kick },
      () => [],
      (d) => sent.push(d),
    );
    await until(() => engineSyncState("s3")?.failed === 1);
    expect(engineSyncState("s3")).toMatchObject({
      failures: ["kick.wav — in use"],
    });
    expect(isHeldBack("s3")).toBe(true);
    sendWhenSynced(
      "s3",
      { clip: kick, v: 2 },
      () => [],
      (d) => sent.push(d),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(sent).toEqual([]);
    expect(asked).toHaveLength(1);
    fail = false;
    forgetSyncFailure("s3");
    sendWhenSynced(
      "s3",
      { clip: kick, v: 3 },
      () => [],
      (d) => sent.push(d),
    );
    await until(() => sent.length > 0);
    expect(sent).toEqual([{ clip: kick, v: 3 }]);
    expect(engineSyncState("s3")).toBeNull();
  });

  it("does not wait on a machine that does not know `sync`", async () => {
    await machine((_req, send) =>
      send({ type: "error", error: "this machine does not do 'sync'" }),
    );
    const sent: unknown[] = [];
    sendWhenSynced(
      "s2",
      { clip: aSong() },
      () => [],
      (d) => sent.push(d),
    );
    await until(() => sent.length > 0);
    expect(sent).toHaveLength(1);
    expect(engineSyncState("s2")).toBeNull();
    sendWhenSynced(
      "s2",
      { clip: aSong() },
      () => [],
      (d) => sent.push(d),
    );
    expect(sent).toHaveLength(2);
    expect(asked).toHaveLength(1);
  });
});
