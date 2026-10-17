// serviceChild.test.ts — a file service's own children die with it, however it ends: a stop, a crash, a kill.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Instances } from "./instances.ts";

// Answers its own secret, and spawns a long-running grandchild whose pid it writes under its home.
const PARENT = `
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(join(process.env.STUDIO_HOME, "grandchild.pid"), String(kid.pid));
if (process.env.IGNORE_TERM) process.on("SIGTERM", () => {});
createServer((req, res) => {
  res.statusCode = req.headers["x-studio-hub-secret"] === process.env.STUDIO_HUB_SECRET ? 200 : 401;
  res.end("{}");
  if (process.env.DIE_AFTER_PROBE) setTimeout(() => process.exit(3), 100);
}).listen(Number(process.env.STUDIO_FILE_PORT), "127.0.0.1");
`;

const dir = mkdtempSync(join(tmpdir(), "service-child-"));
writeFileSync(join(dir, "parent.mjs"), PARENT);

let all: Instances[] = [];
afterEach(async () => {
  for (const i of all) await i.stopAll();
  all = [];
});

function make(extraEnv: Record<string, string>, stopGraceMs = 2_000) {
  const i = new Instances({
    dataRoot: join(dir, "data"),
    command: () => ({
      cmd: process.execPath,
      args: [join(dir, "parent.mjs")],
      cwd: dir,
    }),
    env: () => extraEnv,
    log: () => {},
    readyTimeoutMs: 10_000,
    stopGraceMs,
  });
  all.push(i);
  return i;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Resolves once `pid` is gone, or rejects after `ms`. */
async function gone(pid: number, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (alive(pid)) {
    if (Date.now() > end) throw new Error(`pid ${pid} still running`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const grandchild = (home: string): number =>
  Number(readFileSync(join(home, "grandchild.pid"), "utf8"));

describe.skipIf(process.platform === "win32")(
  "a file service's children",
  () => {
    it("are killed when the hub stops the service", async () => {
      const inst = make({});
      const a = await inst.get("a@x");
      const pid = grandchild(a.home);
      expect(alive(pid)).toBe(true);
      await inst.stopAll();
      await gone(pid);
    });

    it("are killed when the service is killed past its grace", async () => {
      const inst = make({ IGNORE_TERM: "1" }, 200);
      const a = await inst.get("a@x");
      const pid = grandchild(a.home);
      await inst.stopAll();
      expect(a.child.signalCode).toBe("SIGKILL");
      await gone(pid);
    });

    it("are killed when the service exits on its own", async () => {
      const inst = make({ DIE_AFTER_PROBE: "1" });
      const a = await inst.get("a@x");
      const pid = grandchild(a.home);
      await new Promise((r) => a.child.once("exit", r));
      await gone(pid);
    });
  },
);
