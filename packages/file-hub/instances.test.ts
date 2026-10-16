// instances.test.ts — the cap, the eviction, the crash backoff and the gated health probe, over
// FAKE file services: a script that answers its own secret only, and one that dies once up.

import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Instances,
  type Stoppable,
  stopChild,
  Unavailable,
} from "./instances.ts";

const GATED = `
import { createServer } from "node:http";
createServer((req, res) => {
  const ok = req.headers["x-studio-hub-secret"] === process.env.STUDIO_HUB_SECRET;
  res.statusCode = ok ? 200 : 401;
  res.end("{}");
}).listen(Number(process.env.STUDIO_FILE_PORT), "127.0.0.1");
`;
const DIES = `${GATED}\nsetTimeout(() => process.exit(3), 150);`;

const dir = mkdtempSync(join(tmpdir(), "instances-"));
writeFileSync(join(dir, "gated.mjs"), GATED);
writeFileSync(join(dir, "dies.mjs"), DIES);
const run = (script: string) => () => ({
  cmd: process.execPath,
  args: [join(dir, script)],
  cwd: dir,
});

let all: Instances[] = [];
function make(opts: Partial<ConstructorParameters<typeof Instances>[0]>) {
  const i = new Instances({
    dataRoot: join(dir, "data"),
    command: run("gated.mjs"),
    log: () => {},
    readyTimeoutMs: 10_000,
    ...opts,
  });
  all.push(i);
  return i;
}

afterEach(async () => {
  for (const i of all) await i.stopAll();
  all = [];
});

describe("Instances", () => {
  it("refuses past the cap when every instance is busy, and evicts the least recently used idle one", async () => {
    const inst = make({ maxInstances: 2, evictIdleMs: 0 });
    const a = await inst.hold("a@x");
    const b = await inst.hold("b@x");
    await expect(inst.get("c@x")).rejects.toBeInstanceOf(Unavailable);
    b.release();
    a.release();
    a.inst.lastUsed = 1;
    b.inst.lastUsed = 2;
    const gone = new Promise((r) => a.inst.child.once("exit", r));
    const c = await inst.get("c@x");
    await gone;
    expect(c.user).toBe("c@x");
    expect((await inst.running()).map((i) => i.user).sort()).toEqual([
      "b@x",
      "c@x",
    ]);
  });

  it("never evicts a kept account", async () => {
    const inst = make({ maxInstances: 1, evictIdleMs: 0, keep: () => true });
    await inst.get("a@x");
    await expect(inst.get("b@x")).rejects.toBeInstanceOf(Unavailable);
  });

  it("the reaper spares an instance with a request in flight", async () => {
    const inst = make({});
    const held = await inst.hold("a@x");
    await inst.reap(0, Date.now() + 1);
    expect(held.inst.stopping).toBe(false);
    held.release();
    await inst.reap(0, Date.now() + 1);
    expect(held.inst.stopping).toBe(true);
  });

  it("holds a crashing account off with a doubling backoff", async () => {
    const inst = make({
      command: run("dies.mjs"),
      backoffMinMs: 400,
      healthyMs: 60_000,
    });
    const first = await inst.get("a@x");
    await new Promise((r) => first.child.once("exit", r));
    const refused = await inst.get("a@x").catch((e) => e);
    expect(refused).toBeInstanceOf(Unavailable);
    expect((refused as Unavailable).retryAfterS).toBe(1);
    await new Promise((r) => setTimeout(r, 450));
    const second = await inst.get("a@x");
    await new Promise((r) => second.child.once("exit", r));
    const again = await inst.get("a@x").catch((e) => e);
    expect(again).toBeInstanceOf(Unavailable);
    await new Promise((r) => setTimeout(r, 450));
    await expect(inst.get("a@x")).rejects.toBeInstanceOf(Unavailable);
  });

  it("a stop of the hub's own is no crash", async () => {
    const inst = make({ backoffMinMs: 60_000 });
    const a = await inst.get("a@x");
    const gone = new Promise((r) => a.child.once("exit", r));
    await inst.reap(0, Date.now() + 1);
    await gone;
    expect((await inst.get("a@x")).child.pid).not.toBe(a.child.pid);
  });

  it("stopAll closes each child's stdin and waits for it to exit", async () => {
    const STDIN = `${GATED}\nprocess.stdin.on("end", () => setTimeout(() => process.exit(0), 200));\nprocess.stdin.resume();\nprocess.on("SIGTERM", () => {});`;
    writeFileSync(join(dir, "stdin.mjs"), STDIN);
    const inst = make({ command: run("stdin.mjs"), stopGraceMs: 10_000 });
    const a = await inst.get("a@x");
    await inst.stopAll();
    expect(a.child.exitCode).toBe(0);
  });

  it("does not take a port answered under another secret for its own", async () => {
    const owner = make({});
    const a = await owner.get("a@x");
    const thief = make({
      command: () => ({
        cmd: process.execPath,
        args: ["-e", "setTimeout(() => {}, 5000)"],
        cwd: dir,
      }),
      pickPort: async () => a.port,
    });
    await expect(thief.get("b@x")).rejects.toThrow(/another secret/);
  });
});

/** A child that exits on its stdin's end when `obeys`, and on SIGKILL always. */
function fakeChild(obeys: boolean) {
  const ee = new EventEmitter();
  const stdin = new PassThrough();
  const kill = vi.fn((sig?: string) => {
    if (sig === "SIGKILL") queueMicrotask(() => ee.emit("exit", null, sig));
    return true;
  });
  if (obeys) stdin.on("finish", () => ee.emit("exit", 0, null));
  const child = {
    pid: 1,
    exitCode: null,
    signalCode: null,
    stdin,
    kill,
    once: ee.once.bind(ee),
  } as unknown as Stoppable;
  return { child, kill };
}

describe("stopChild", () => {
  it("asks through stdin and SIGTERM, and kills nothing that obeys", async () => {
    const { child, kill } = fakeChild(true);
    await stopChild(child, 1_000, false);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    expect(kill).not.toHaveBeenCalledWith("SIGKILL");
  });

  it("sends no signal on Windows, where a kill is not a request", async () => {
    const { child, kill } = fakeChild(true);
    await stopChild(child, 1_000, true);
    expect(kill).not.toHaveBeenCalled();
  });

  it("waits the grace, then kills a child that does not stop", async () => {
    vi.useFakeTimers();
    try {
      const { child, kill } = fakeChild(false);
      let done = false;
      const p = stopChild(child, 5_000, true).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(4_900);
      expect(done).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      await p;
      expect(kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
