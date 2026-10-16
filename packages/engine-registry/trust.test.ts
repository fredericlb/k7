// trust.test.ts — who may list and tunnel under an engine id: the first tunnel secret binds it,
// on disk, and a token alone — which every relay user can read — never takes a bound id back.
// docs/token.md is the prose; this is the contract.

import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createBindings } from "./bindings.ts";
import {
  createRegistry,
  type EngineRegistry,
  type HeartbeatInput,
  REGISTRY_TTL_MS,
} from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

const SECRET = "s".repeat(64);
const OTHER = "o".repeat(64);

const beat = (over: Partial<HeartbeatInput> = {}): HeartbeatInput => ({
  id: "e1",
  token: "tok",
  hostname: "studio",
  machineFingerprint: "fp",
  addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
  publicIpHint: "203.0.113.5",
  ...over,
});

describe("the secret bindings", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bindings-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("binds an id to its first secret, on disk, readable by its owner alone", () => {
    const file = join(dir, "b.json");
    const a = createBindings(file, () => {});
    expect(a.check("e1", SECRET)).toBe("fresh");
    a.bind("e1", SECRET);
    // A restart reads it back: the binding is not the registry's 15 s memory.
    const b = createBindings(file, () => {});
    expect(b.check("e1", SECRET)).toBe("bound");
    expect(b.check("e1", OTHER)).toBe("refused");
    expect(b.check("e1", undefined)).toBe("refused");
    expect(b.check("e2", undefined)).toBe("legacy");
    // Only a digest is kept.
    expect(readFileSync(file, "utf8")).not.toContain(SECRET);
    if (process.platform !== "win32")
      expect(statSync(file).mode & 0o077).toBe(0);
  });

  it("sets an unreadable file aside rather than trusting or overwriting it", () => {
    const file = join(dir, "b.json");
    createBindings(file, () => {}).bind("e1", SECRET);
    rmSync(file);
    const lines: string[] = [];
    writeFileSync(file, "{not json");
    const b = createBindings(file, (l) => lines.push(l));
    expect(b.check("e1", SECRET)).toBe("fresh");
    expect(lines.join("\n")).toMatch(/unreadable/);
  });
});

describe("the registry under the bindings", () => {
  let reg: EngineRegistry;
  beforeEach(() => {
    vi.useFakeTimers();
    reg = createRegistry({ bindings: createBindings(undefined, () => {}) });
  });
  afterEach(() => vi.useRealTimers());

  it("refuses a different secret for a bound id, even after the entry lapsed", () => {
    expect(reg.upsert(beat({ tunnelSecret: SECRET }))).toEqual({ ok: true });
    vi.advanceTimersByTime(REGISTRY_TTL_MS + 1);
    expect(reg.get("e1")).toBeUndefined();
    expect(reg.upsert(beat({ tunnelSecret: OTHER }))).toEqual({
      ok: false,
      why: "secret",
    });
    expect(reg.get("e1")).toBeUndefined();
  });

  it("never lets a legacy heartbeat (no secret) take a bound id, with the right token or not", () => {
    reg.upsert(beat({ tunnelSecret: SECRET }));
    expect(reg.upsert(beat())).toEqual({ ok: false, why: "secret" });
    vi.advanceTimersByTime(REGISTRY_TTL_MS + 1);
    expect(reg.upsert(beat({ token: "fresh" }))).toEqual({
      ok: false,
      why: "secret",
    });
  });

  it("lets the bound machine change its token, the secret being the proof", () => {
    reg.upsert(beat({ tunnelSecret: SECRET }));
    expect(reg.upsert(beat({ token: "new", tunnelSecret: SECRET }))).toEqual({
      ok: true,
    });
    expect(reg.verifyToken("e1", "new")).toBe(true);
  });

  it("lists a legacy engine as such, and still pins its first token", () => {
    expect(reg.upsert(beat())).toEqual({ ok: true });
    expect(reg.list()[0]?.legacy).toBe(true);
    expect(reg.upsert(beat({ token: "other" }))).toEqual({
      ok: false,
      why: "token",
    });
    // A legacy engine that updates gains a binding with the token it already had.
    expect(reg.upsert(beat({ tunnelSecret: SECRET }))).toEqual({ ok: true });
    expect(reg.list()[0]?.legacy).toBeUndefined();
  });

  it("opens a tunnel only with the bound secret; a legacy id on its token", () => {
    reg.upsert(beat({ tunnelSecret: SECRET }));
    expect(reg.verifyTunnel("e1", "tok", SECRET)).toBe(true);
    expect(reg.verifyTunnel("e1", "tok", OTHER)).toBe(false);
    expect(reg.verifyTunnel("e1", "tok", undefined)).toBe(false);
    expect(reg.verifyTunnel("e1", "nope", SECRET)).toBe(false);
    reg.upsert(beat({ id: "old" }));
    expect(reg.verifyTunnel("old", "tok", undefined)).toBe(true);
  });

  it("keeps a bound id listed against a deregister carrying the token alone", () => {
    reg.upsert(beat({ tunnelSecret: SECRET }));
    expect(reg.remove("e1", "tok")).toBe(false);
    expect(reg.remove("e1", "tok", SECRET)).toBe(true);
  });

  it("caps the list, and the new ids one address may add in a minute", () => {
    const small = createRegistry({
      bindings: createBindings(undefined, () => {}),
      maxEngines: 2,
      newIdsPerIpPerMinute: 1,
    });
    expect(small.upsert(beat({ id: "a" }))).toEqual({ ok: true });
    expect(small.upsert(beat({ id: "b" }))).toEqual({ ok: false, why: "rate" });
    // Renewing an id already listed is not a new one.
    expect(small.upsert(beat({ id: "a" }))).toEqual({ ok: true });
    expect(
      small.upsert(beat({ id: "b", publicIpHint: "198.51.100.1" })),
    ).toEqual({ ok: true });
    expect(
      small.upsert(beat({ id: "c", publicIpHint: "198.51.100.2" })),
    ).toEqual({ ok: false, why: "full" });
  });
});

describe("the heartbeat and tunnel routes", () => {
  let reg: EngineRegistry;
  let hub: TunnelHub;
  let server: Server;
  let base: string;
  const logged: string[] = [];

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      status: res.status,
      body: (await res.json()) as { error?: string },
    };
  };

  /** Open a tunnel as a supervisor would, resolving the socket or the refusal's status. */
  const tunnel = (secret?: string): Promise<WebSocket | number> =>
    new Promise((resolve) => {
      const ws = new WebSocket(
        `${base.replace("http", "ws")}/api/engine-tunnel?id=e1`,
        {
          headers: {
            "x-studio-engine-token": "tok",
            ...(secret ? { "x-studio-tunnel-secret": secret } : {}),
          },
        },
      );
      ws.once("open", () => resolve(ws));
      ws.once("unexpected-response", (_req, res) =>
        resolve(res.statusCode ?? 0),
      );
      ws.once("error", () => resolve(0));
    });

  beforeEach(async () => {
    logged.length = 0;
    reg = createRegistry({ bindings: createBindings(undefined, () => {}) });
    hub = new TunnelHub({
      verify: (id, token, secret) => reg.verifyTunnel(id, token, secret),
      log: () => {},
    });
    const app = express();
    app.use(express.json());
    app.use(
      "/api",
      engineRegistryRouter(reg, hub, (l) => logged.push(l)),
    );
    server = app.listen(0);
    hub.attach(server);
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    hub.stop();
    await new Promise((r) => server.close(r));
  });

  const body = (over: Record<string, unknown> = {}) => ({
    id: "e1",
    token: "tok",
    addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
    ...over,
  });

  it("answers 403 to a heartbeat with another secret for a bound id, and says so in the log", async () => {
    expect(
      (await post("/registry/heartbeat", body({ tunnelSecret: SECRET })))
        .status,
    ).toBe(200);
    const r = await post("/registry/heartbeat", body({ tunnelSecret: OTHER }));
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/bound to another machine/);
    expect(logged.join("\n")).toMatch(/refused a heartbeat from engine e1/);
  });

  it("refuses an id or a token past its bounds", async () => {
    expect(
      (await post("/registry/heartbeat", body({ id: "a/b" }))).status,
    ).toBe(400);
    expect(
      (await post("/registry/heartbeat", body({ id: "x".repeat(129) }))).status,
    ).toBe(400);
    expect(
      (await post("/registry/heartbeat", body({ token: "t".repeat(257) })))
        .status,
    ).toBe(400);
    expect(
      (await post("/registry/heartbeat", body({ tunnelSecret: "short" })))
        .status,
    ).toBe(400);
  });

  it("refuses a tunnel with the wrong secret and keeps the incumbent; the right one replaces it", async () => {
    await post("/registry/heartbeat", body({ tunnelSecret: SECRET }));
    const first = await tunnel(SECRET);
    expect(first).toBeInstanceOf(WebSocket);
    expect(hub.has("e1")).toBe(true);

    expect(await tunnel(OTHER)).toBe(403);
    expect(await tunnel()).toBe(403);
    expect((first as WebSocket).readyState).toBe(WebSocket.OPEN);

    const closed = new Promise((r) => (first as WebSocket).once("close", r));
    const second = await tunnel(SECRET);
    expect(second).toBeInstanceOf(WebSocket);
    await closed;
    expect(hub.has("e1")).toBe(true);
    (second as WebSocket).close();
  });
});
