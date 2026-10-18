// app.e2e.ts — the desktop app booted for real: the window reaches k7, the engine comes up, the library is seeded, a quit stops it all.
// One launch for the whole file, since a boot costs seconds; the steps run in order and a red one skips the rest. See docs/e2e.md.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { homePage, K7, type Launched, launchApp } from "./launch.ts";

/** CI sets it: a build without the supervisor is then a failure, not a skip. */
const ENGINE_REQUIRED = process.env.K7_E2E_ENGINE === "1";

/** A cold first boot seeds the library and starts the engine: minutes on a slow runner, not seconds. */
const BOOT_MS = 120_000;

interface EngineState {
  snapshot: {
    status: string;
    enginePort: number;
    lastHeartbeatOk: boolean;
    error?: string;
  } | null;
  down: string | null;
}

test.describe.configure({ mode: "serial" });

let launched: Launched;
let home: Page;
let enginePort = 0;

test.beforeAll(async () => {
  launched = await launchApp();
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright refuses a hook whose fixtures argument is not destructured.
test.afterAll(async ({}, testInfo) => {
  if (!launched) return;
  // Closed here too, so a red step never leaves the app holding the port for the next run.
  await launched.app.close().catch(() => undefined);
  const log = join(launched.userData, "standalone.log");
  if (testInfo.status !== "passed" && existsSync(log))
    await testInfo.attach("standalone.log", { body: readFileSync(log) });
  rmSync(launched.userData, { recursive: true, force: true });
});

test("the window leaves the splash for k7's home page", async () => {
  home = await homePage(launched, BOOT_MS);
  await home.waitForLoadState("domcontentloaded");
  await expect(home).toHaveURL(`${K7}/`, { timeout: BOOT_MS });
  await expect(home.locator("body")).not.toBeEmpty();
});

test("the engine starts and registers with the app's backend", async () => {
  const first = await engineState(home);
  const noBuild = first.down?.includes("no k7-supervisor") ?? false;
  test.skip(
    noBuild && !ENGINE_REQUIRED,
    "this checkout has no supervisor build",
  );
  // A build with no supervisor never grows one: no point polling for it.
  expect(noBuild, `the app found no supervisor: ${first.down}`).toBe(false);

  await expect
    .poll(
      async () => {
        const s = await engineState(home);
        if (s.down) return s.down;
        if (s.snapshot?.error) return s.snapshot.error;
        if (!s.snapshot) return "no snapshot yet";
        // A snapshot says running before its first heartbeat and port: that is not up yet.
        if (s.snapshot.status === "running" && !s.snapshot.lastHeartbeatOk)
          return "running, no heartbeat yet";
        if (s.snapshot.status === "running" && s.snapshot.enginePort <= 0)
          return "running, no port yet";
        enginePort = s.snapshot.enginePort;
        return s.snapshot.status;
      },
      { timeout: BOOT_MS, intervals: [1000] },
    )
    .toBe("running");
  expect(enginePort).toBeGreaterThan(0);
});

test("the k7-core library is seeded into the app's own folder", async () => {
  await expect
    .poll(
      () => findDir(launched.userData, ["libraries", "k7-core"], 4) !== null,
      {
        timeout: BOOT_MS,
        intervals: [1000],
      },
    )
    .toBe(true);
});

test("quitting stops the backend and the engine", async () => {
  await launched.app.close();
  const backendPort = Number(new URL(K7).port);
  await expect
    .poll(() => listening(backendPort), { timeout: 30_000 })
    .toBe(false);
  if (enginePort)
    await expect
      .poll(() => listening(enginePort), { timeout: 30_000 })
      .toBe(false);
});

/** What the preload's `studioEngine` bridge reports to a page of the app (src/engineBridge.ts). */
function engineState(page: Page): Promise<EngineState> {
  return page.evaluate(() => {
    const bridge = (
      globalThis as unknown as { studioEngine: { state(): Promise<unknown> } }
    ).studioEngine;
    return bridge.state() as Promise<EngineState>;
  });
}

/** The first folder under `root`, at most `depth` levels down, whose path ends with `tail`. */
function findDir(root: string, tail: string[], depth: number): string | null {
  if (depth < 0 || !existsSync(root)) return null;
  const parts = root.split(/[\\/]/);
  if (tail.every((t, i) => parts[parts.length - tail.length + i] === t))
    return root;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const hit = findDir(join(root, entry.name), tail, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** Whether something accepts a connection on the loopback `port`. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
