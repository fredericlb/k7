// instances.test.ts — the cap, the eviction, the crash backoff and the gated health probe, over
// FAKE file services: a script that answers its own secret only, and one that dies once up.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Instances, Unavailable } from "./instances.ts";

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
