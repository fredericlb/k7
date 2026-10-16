// heartbeatGate.test.ts — who may LIST an engine: a machine paired with an account (its device token), or the
// server's render machine (the render key); with the gate off, anyone, and an unpaired one is said. See docs/heartbeat.md.

import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter, type HeartbeatGate } from "./router.ts";

const beat = (id: string) => ({
  id,
  token: `tok-${id}`,
  hostname: "studio",
  machineFingerprint: "fp",
  addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
});

const closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers.splice(0)) c();
});

async function registryWith(
  requireDevice: boolean,
): Promise<{ reg: EngineRegistry; logged: string[]; base: string }> {
  const reg = createRegistry();
  const logged: string[] = [];
  const gate: HeartbeatGate = {
    requireDevice,
    deviceOf: (t) => (t === "device-of-alice" ? "alice" : null),
    renderKey: "the-render-key",
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    engineRegistryRouter(reg, undefined, (l) => logged.push(l), {
      heartbeat: gate,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  closers.push(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { reg, logged, base };
}

const send = (base: string, id: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/registry/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(beat(id)),
  });

describe("the heartbeat gate", () => {
  it("lists only a paired machine or the render machine when the studio asks for it", async () => {
    const { reg, base } = await registryWith(true);

    const stranger = await send(base, "rogue");
    expect(stranger.status).toBe(401);
    expect(String((await stranger.json()).error)).toMatch(
      /STUDIO_DEVICE_TOKEN/,
    );
    expect(reg.get("rogue")).toBeUndefined();

    const forged = await send(base, "forged", {
      authorization: "Bearer not-a-token",
    });
    expect(forged.status).toBe(401);

    const paired = await send(base, "laptop", {
      authorization: "Bearer device-of-alice",
    });
    expect(paired.status).toBe(200);
    expect(reg.get("laptop")).toBeDefined();

    const render = await send(base, "server", {
      "x-studio-render-key": "the-render-key",
    });
    expect(render.status).toBe(200);
    const wrongKey = await send(base, "server2", {
      "x-studio-render-key": "nope",
    });
    expect(wrongKey.status).toBe(401);
  });

  it("still lists everyone with the gate off, and says which machines are unpaired", async () => {
    const { reg, logged, base } = await registryWith(false);
    expect((await send(base, "old-supervisor")).status).toBe(200);
    expect(reg.get("old-supervisor")).toBeDefined();
    expect(logged.join("\n")).toMatch(
      /took a heartbeat from engine old-supervisor.*no device token/,
    );
  });
});
