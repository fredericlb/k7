// ownership.test.ts — an engine is its enrolling account's: the store outlives a restart, `select`
// refuses everyone the owner did not share it with, the first direct open enrols, the relay never
// hands the token to an account that may not use the engine, and only the owner (or an admin)
// edits the shares or gives the engine up.

import { mkdtempSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createBindings } from "./bindings.ts";
import { cleanShares, createOwners, OWNERS_FILE, roleOf } from "./owners.ts";
import { attachEngineProxy, issueEngineTicket } from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { engineRegistryRouter } from "./router.ts";

const quiet = () => {};

describe("the owners store", () => {
  it("persists an owner and its shares across a restart, and forgets a released one", () => {
    const file = join(mkdtempSync(join(tmpdir(), "owners-")), OWNERS_FILE);
    const a = createOwners(file, quiet);
    expect(a.enrol("e1", "ann@x")).toBe(true);
    expect(a.enrol("e1", "bob@x")).toBe(false);
    a.share("e1", ["bob@x"]);
    a.enrol("e2", "ann@x");
    a.release("e2");
    const b = createOwners(file, quiet);
    expect(b.get("e1")).toMatchObject({ owner: "ann@x", shared: ["bob@x"] });
    expect(b.get("e2")).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("reads each account's role, the server's engine being everybody's", () => {
    const o = { owner: "ann@x", shared: ["bob@x"], since: 0 };
    expect(roleOf(o, "ann@x", false)).toBe("owner");
    expect(roleOf(o, "BOB@x", false)).toBe("shared");
    expect(roleOf(o, "eve@x", false)).toBe("none");
    expect(roleOf(o, "eve@x", true)).toBe("server");
    expect(roleOf(undefined, "eve@x", false)).toBe("unowned");
  });

  it("cleans a share list and names what is not an email", () => {
    expect(cleanShares([" Bob@X ", "bob@x", ""])).toEqual({
      ok: true,
      emails: ["bob@x"],
    });
    expect(cleanShares(["bob"])).toEqual({ ok: false, bad: "bob" });
  });
});

/** A registry behind its routes, with the session's account read from an `x-user` header. */
async function routes(server: { renderer?: string } = {}) {
  const reg = createRegistry({ bindings: createBindings(undefined, quiet) });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const email = req.header("x-user");
    if (email) (req as { user?: object }).user = { email };
    next();
  });
  const tunnels = {
    has: () => false,
    isRenderer: (id: string) => id === server.renderer,
  };
  app.use(
    "/api",
    engineRegistryRouter(reg, tunnels as never, quiet, {
      isAdmin: (req) =>
        (req as { user?: { email?: string } }).user?.email === "root@x",
    }),
  );
  const http = app.listen(0);
  await new Promise<void>((r) => http.once("listening", () => r()));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const call = async (
    user: string,
    method: string,
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { "content-type": "application/json", "x-user": user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as never };
  };
  // Every socket closed with the server, so no keep-alive connection outlives its test.
  const close = () => {
    http.closeAllConnections();
    http.close();
  };
  return { reg, call, close };
}

const beat = (reg: EngineRegistry, id: string, ip = "10.0.0.9") =>
  reg.upsert({
    id,
    token: `tok-${id}`,
    hostname: `host-${id}`,
    machineFingerprint: "",
    addresses: { loopback: "127.0.0.1", lanIps: ["192.168.1.9"], port: 8765 },
    publicIpHint: ip,
  });

describe("select, listing and the share routes", () => {
  let r: Awaited<ReturnType<typeof routes>>;
  beforeEach(async () => {
    r = await routes({ renderer: "srv" });
    beat(r.reg, "e1");
    beat(r.reg, "srv");
  });
  afterEach(() => r.close());

  const select = (user: string, id = "e1", secret?: string) =>
    r.call(user, "POST", "/engine/select", {
      id,
      token: `tok-${id}`,
      project: null,
      secret,
    });

  it("enrols the first account that opens an unowned engine with its token", async () => {
    expect((await select("ann@x")).status).toBe(200);
    expect(r.reg.owners.get("e1")?.owner).toBe("ann@x");
    const eve = await select("eve@x");
    expect(eve.status).toBe(403);
    expect(eve.body).toMatchObject({ error: "not-yours" });
    expect(r.reg.holds("e1", "ann@x")).toBe(true);
  });

  it("refuses an anonymous session, which can own nothing", async () => {
    expect((await select("")).status).toBe(403);
    expect(r.reg.owners.get("e1")).toBeUndefined();
  });

  it("lets the owner and a shared account claim, and every account the server's engine", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    r.reg.owners.share("e1", ["bob@x"]);
    expect((await select("ann@x")).status).toBe(200);
    const bob = await select("bob@x");
    expect(bob.status).toBe(200);
    // Between allowed accounts the claim rules still hold: a claim with no project displaces nobody.
    expect((bob.body as { tookOver?: unknown }).tookOver).toBeUndefined();
    expect((await select("eve@x", "srv")).status).toBe(200);
    expect(r.reg.owners.get("srv")).toBeUndefined();
  });

  it("does not enrol on a renewal", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    const open = await select("ann@x");
    r.reg.owners.release("e1");
    const secret = (open.body as { secret: string }).secret;
    expect((await select("ann@x", "e1", secret)).status).toBe(200);
    expect(r.reg.owners.get("e1")).toBeUndefined();
  });

  it("lists owned engines to their accounts alone, the server's to all, an unowned one without its LAN or a ticket", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    const ann = (await r.call("ann@x", "GET", "/engines")).body as {
      id: string;
      access: string;
      proxyTicket?: string;
    }[];
    expect(ann.map((e) => [e.id, e.access])).toEqual([
      ["e1", "owner"],
      ["srv", "server"],
    ]);
    expect(ann[0]?.proxyTicket).toBeTruthy();
    const eve = (await r.call("eve@x", "GET", "/engines")).body as {
      id: string;
    }[];
    expect(eve.map((e) => e.id)).toEqual(["srv"]);

    beat(r.reg, "e3");
    const fresh = (
      (await r.call("eve@x", "GET", "/engines")).body as {
        id: string;
        access: string;
        proxyTicket?: string;
        addresses: { lanIps: string[] };
      }[]
    ).find((e) => e.id === "e3");
    expect(fresh?.access).toBe("unowned");
    expect(fresh?.proxyTicket).toBeUndefined();
    expect(fresh?.addresses.lanIps).toEqual([]);
  });

  it("names the owner to a shared account", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    r.reg.owners.share("e1", ["bob@x"]);
    const bob = (await r.call("bob@x", "GET", "/engines")).body as {
      id: string;
      access: string;
      ownedBy?: string;
    }[];
    expect(bob[0]).toMatchObject({
      id: "e1",
      access: "shared",
      ownedBy: "ann@x",
    });
  });

  it("lets the owner alone read and replace the shares, and a withdrawn share ends that claim", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    expect(
      (
        await r.call("bob@x", "PUT", "/engines/e1/shares", {
          emails: ["bob@x"],
        })
      ).status,
    ).toBe(404);
    const put = await r.call("ann@x", "PUT", "/engines/e1/shares", {
      emails: ["Bob@x", "bob@x"],
    });
    expect(put.body).toMatchObject({ ok: true, shared: ["bob@x"] });
    expect((await r.call("bob@x", "GET", "/engines/e1/shares")).status).toBe(
      404,
    );
    expect(
      (await r.call("ann@x", "GET", "/engines/e1/shares")).body,
    ).toMatchObject({ owner: "ann@x", shared: ["bob@x"] });
    expect(
      (await r.call("ann@x", "PUT", "/engines/e1/shares", { emails: ["nope"] }))
        .status,
    ).toBe(400);

    expect((await select("bob@x")).status).toBe(200);
    await r.call("ann@x", "PUT", "/engines/e1/shares", { emails: [] });
    expect(r.reg.holds("e1", "bob@x")).toBe(false);
  });

  it("lets the owner give it up and an admin reset it, nobody else", async () => {
    r.reg.owners.enrol("e1", "ann@x");
    expect((await r.call("eve@x", "DELETE", "/engines/e1/owner")).status).toBe(
      404,
    );
    expect((await r.call("eve@x", "GET", "/engines/owners")).status).toBe(403);
    const all = await r.call("root@x", "GET", "/engines/owners");
    expect(all.body).toEqual([expect.objectContaining({ id: "e1" })]);
    expect((await r.call("root@x", "DELETE", "/engines/e1/owner")).status).toBe(
      200,
    );
    expect(r.reg.owners.get("e1")).toBeUndefined();
    r.reg.owners.enrol("e1", "ann@x");
    expect((await r.call("ann@x", "DELETE", "/engines/e1/owner")).status).toBe(
      200,
    );
    expect(r.reg.owners.get("e1")).toBeUndefined();
  });
});

describe("the relay and the token", () => {
  let reg: EngineRegistry;
  let server: Server;
  let engine: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    engine = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    engine.on("connection", (ws) => {
      let first = true;
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        if (first) {
          first = false;
          ws.send(JSON.stringify({ type: "paired" }));
          return;
        }
        if (m.type === "whoami")
          ws.send(JSON.stringify({ type: "whoami", id: "e1", token: "tok" }));
      });
    });
    await new Promise((r) => engine.once("listening", r));
    reg = createRegistry({ bindings: createBindings(undefined, quiet) });
    reg.upsert({
      id: "e1",
      token: "tok",
      hostname: "h",
      machineFingerprint: "",
      addresses: {
        loopback: "127.0.0.1",
        lanIps: [],
        port: (engine.address() as AddressInfo).port,
      },
      publicIpHint: "127.0.0.1",
    });
    server = createServer();
    attachEngineProxy(server, reg);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const c of engine.clients) c.terminate();
    await new Promise((r) => engine.close(r));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  /** The whoami a browser of account `holder` reads through the relay. */
  const whoami = (holder: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const ticket = encodeURIComponent(issueEngineTicket("e1", holder));
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/api/engine/e1/ws?ticket=${ticket}`,
      );
      ws.once("open", () => ws.send(JSON.stringify({ type: "whoami" })));
      ws.on("message", (d) => {
        ws.close();
        resolve(JSON.parse(String(d)));
      });
      ws.once("error", reject);
    });

  it("hands the token to nobody while the engine is unowned, so a relayed browser cannot enrol it", async () => {
    expect(await whoami("eve@x")).toEqual({ type: "whoami", id: "e1" });
  });

  it("hands it to the owner and a shared account, never to another", async () => {
    reg.owners.enrol("e1", "ann@x");
    reg.owners.share("e1", ["bob@x"]);
    expect((await whoami("ann@x")).token).toBe("tok");
    expect((await whoami("bob@x")).token).toBe("tok");
    expect((await whoami("eve@x")).token).toBeUndefined();
  });
});
