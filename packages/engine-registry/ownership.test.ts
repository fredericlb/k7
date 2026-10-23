// ownership.test.ts — an engine is the account its heartbeat proves: the store outlives a restart, a
// proven heartbeat assigns or moves the owner, an open enrols nobody, `select` refuses everyone the
// owner did not share it with (or with everyone), an engine on the backend's own machine is every
// account's, the relay never hands the token to an account that may not use it.

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
  it("persists an owner, its shares and its everyone flag across a restart, and forgets a released one", () => {
    const file = join(mkdtempSync(join(tmpdir(), "owners-")), OWNERS_FILE);
    const a = createOwners(file, quiet);
    expect(a.assign("e1", "ann@x")).toBe("new");
    expect(a.assign("e1", "ann@x")).toBe("same");
    a.share("e1", ["bob@x"], true);
    a.assign("e2", "ann@x");
    a.release("e2");
    const b = createOwners(file, quiet);
    expect(b.get("e1")).toMatchObject({
      owner: "ann@x",
      shared: ["bob@x"],
      everyone: true,
    });
    expect(b.get("e2")).toBeUndefined();
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
  });

  it("moves an engine to another account, which does not inherit the old shares", () => {
    const o = createOwners(undefined, quiet);
    o.assign("e1", "ann@x");
    o.share("e1", ["bob@x"], true);
    expect(o.assign("e1", "cat@x")).toBe("moved");
    expect(o.get("e1")).toMatchObject({
      owner: "cat@x",
      shared: [],
      everyone: false,
    });
  });

  it("leaves the everyone flag as it was when a share edit does not name it", () => {
    const o = createOwners(undefined, quiet);
    o.assign("e1", "ann@x");
    o.share("e1", [], true);
    o.share("e1", ["bob@x"]);
    expect(o.get("e1")?.everyone).toBe(true);
  });

  it("reads each account's role, the server's engine being everybody's", () => {
    const o = { owner: "ann@x", shared: ["bob@x"], everyone: false, since: 0 };
    expect(roleOf(o, "ann@x", false)).toBe("owner");
    expect(roleOf(o, "BOB@x", false)).toBe("shared");
    expect(roleOf(o, "eve@x", false)).toBe("none");
    expect(roleOf({ ...o, everyone: true }, "eve@x", false)).toBe("shared");
    expect(roleOf({ ...o, everyone: true }, "", false)).toBe("none");
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

/** The device tokens of the tests' heartbeat gate, and the account each proves. */
const DEVICES: Record<string, string> = {
  "dev-ann": "ann@x",
  "dev-cat": "cat@x",
};

/** A registry behind its routes, with the session's account read from an `x-user` header. */
async function routes(server: { renderer?: string } = {}) {
  const reg = createRegistry({ bindings: createBindings(undefined, quiet) });
  const app = express();
  // So a test heartbeat can come from the LAN rather than from this loopback.
  app.set("trust proxy", true);
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
      heartbeat: {
        requireDevice: false,
        deviceOf: (t) => DEVICES[t] ?? null,
        renderKey: "the-render-key",
      },
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
  /** A heartbeat over the route, from the LAN unless told otherwise, with these credentials. */
  const heartbeat = (id: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/registry/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.9",
        ...headers,
      },
      body: JSON.stringify({
        id,
        token: `tok-${id}`,
        hostname: `host-${id}`,
        machineFingerprint: "fp",
        addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
      }),
    });
  // Every socket closed with the server, so no keep-alive connection outlives its test.
  const close = () => {
    http.closeAllConnections();
    http.close();
  };
  return { reg, call, heartbeat, close };
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

describe("the heartbeat names the owner", () => {
  let r: Awaited<ReturnType<typeof routes>>;
  beforeEach(async () => {
    r = await routes();
  });
  afterEach(() => r.close());

  it("makes the account a device token proves the owner, from the first heartbeat", async () => {
    expect(
      (await r.heartbeat("e1", { authorization: "Bearer dev-ann" })).status,
    ).toBe(200);
    expect(r.reg.owners.get("e1")?.owner).toBe("ann@x");
  });

  it("owns nothing on a heartbeat that proves no account, the render machine's included", async () => {
    await r.heartbeat("e1");
    await r.heartbeat("e2", { authorization: "Bearer forged" });
    await r.heartbeat("srv", { "x-studio-render-key": "the-render-key" });
    expect(r.reg.owners.all()).toEqual([]);
  });

  it("moves the engine to the account a later heartbeat proves, ending the old owner's claims", async () => {
    await r.heartbeat("e1", { authorization: "Bearer dev-ann" });
    const open = await r.call("ann@x", "POST", "/engine/select", {
      id: "e1",
      token: "tok-e1",
      project: null,
    });
    expect(open.status).toBe(200);
    await r.heartbeat("e1", { authorization: "Bearer dev-cat" });
    expect(r.reg.owners.get("e1")?.owner).toBe("cat@x");
    expect(r.reg.holds("e1", "ann@x")).toBe(false);
  });
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

  it("refuses to open an unowned engine, and an open enrols nobody", async () => {
    const ann = await select("ann@x");
    expect(ann.status).toBe(403);
    expect(ann.body).toMatchObject({ error: "unowned" });
    expect(r.reg.owners.get("e1")).toBeUndefined();
  });

  it("refuses an anonymous session, which can own nothing", async () => {
    r.reg.owners.assign("e1", "ann@x");
    expect((await select("")).status).toBe(403);
  });

  it("lets the owner and a shared account claim, and every account the server's engine", async () => {
    r.reg.owners.assign("e1", "ann@x");
    r.reg.owners.share("e1", ["bob@x"]);
    expect((await select("ann@x")).status).toBe(200);
    const bob = await select("bob@x");
    expect(bob.status).toBe(200);
    // Between allowed accounts the claim rules still hold: a claim with no project displaces nobody.
    expect((bob.body as { tookOver?: unknown }).tookOver).toBeUndefined();
    const eve = await select("eve@x");
    expect(eve.status).toBe(403);
    expect(eve.body).toMatchObject({ error: "not-yours" });
    expect((await select("eve@x", "srv")).status).toBe(200);
    expect(r.reg.owners.get("srv")).toBeUndefined();
  });

  it("lists owned engines to their accounts alone, the server's to all, an unowned one without its LAN or a ticket", async () => {
    r.reg.owners.assign("e1", "ann@x");
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
    r.reg.owners.assign("e1", "ann@x");
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
    r.reg.owners.assign("e1", "ann@x");
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
    expect(put.body).toMatchObject({
      ok: true,
      shared: ["bob@x"],
      everyone: false,
    });
    expect((await r.call("bob@x", "GET", "/engines/e1/shares")).status).toBe(
      404,
    );
    expect(
      (await r.call("ann@x", "GET", "/engines/e1/shares")).body,
    ).toMatchObject({ owner: "ann@x", shared: ["bob@x"], everyone: false });
    expect(
      (await r.call("ann@x", "PUT", "/engines/e1/shares", { emails: ["nope"] }))
        .status,
    ).toBe(400);

    expect((await select("bob@x")).status).toBe(200);
    await r.call("ann@x", "PUT", "/engines/e1/shares", { emails: [] });
    expect(r.reg.holds("e1", "bob@x")).toBe(false);
  });

  it("shares with everyone on the server, and withdrawing it ends their claims", async () => {
    r.reg.owners.assign("e1", "ann@x");
    expect((await select("eve@x")).status).toBe(403);
    const put = await r.call("ann@x", "PUT", "/engines/e1/shares", {
      emails: [],
      everyone: true,
    });
    expect(put.body).toMatchObject({ ok: true, everyone: true });
    const eve = (await r.call("eve@x", "GET", "/engines")).body as {
      id: string;
      access: string;
    }[];
    expect(eve.find((e) => e.id === "e1")?.access).toBe("shared");
    expect((await select("eve@x")).status).toBe(200);
    await r.call("ann@x", "PUT", "/engines/e1/shares", {
      emails: [],
      everyone: false,
    });
    expect(r.reg.holds("e1", "eve@x")).toBe(false);
  });

  it("lets the owner give it up and an admin reset it, nobody else", async () => {
    r.reg.owners.assign("e1", "ann@x");
    expect((await r.call("eve@x", "DELETE", "/engines/e1/owner")).status).toBe(
      404,
    );
    expect((await r.call("eve@x", "GET", "/engines/owners")).status).toBe(403);
    const all = await r.call("root@x", "GET", "/engines/owners");
    expect(all.body).toEqual([
      expect.objectContaining({
        id: "e1",
        owner: "ann@x",
        hostname: "host-e1",
        online: true,
      }),
    ]);
    expect((await r.call("root@x", "DELETE", "/engines/e1/owner")).status).toBe(
      200,
    );
    expect(r.reg.owners.get("e1")).toBeUndefined();
    r.reg.owners.assign("e1", "ann@x");
    expect((await r.call("ann@x", "DELETE", "/engines/e1/owner")).status).toBe(
      200,
    );
    expect(r.reg.owners.get("e1")).toBeUndefined();
  });
});

describe("the backend's own machine", () => {
  let r: Awaited<ReturnType<typeof routes>>;
  beforeEach(async () => {
    r = await routes();
    // The backend machine's engine beats from loopback; a LAN one from another machine.
    beat(r.reg, "own", "::ffff:127.0.0.1");
    beat(r.reg, "lan");
    r.reg.owners.assign("own", "local@x");
    r.reg.owners.assign("lan", "local@x");
  });
  afterEach(() => r.close());

  it("lists its engine to every signed-in account, and nobody else's", async () => {
    const fred = (await r.call("fred@x", "GET", "/engines")).body as {
      id: string;
      access: string;
    }[];
    expect(fred.map((e) => [e.id, e.access])).toEqual([["own", "owner"]]);
    expect((await r.call("", "GET", "/engines")).body).toEqual([]);
  });

  it("lets another account select it, without changing whose it is", async () => {
    const res = await r.call("fred@x", "POST", "/engine/select", {
      id: "own",
      token: "tok-own",
      project: null,
    });
    expect(res.status).toBe(200);
    expect(r.reg.owners.get("own")?.owner).toBe("local@x");
  });

  it("stays this machine's when it also beats through a proxy, which hides that it is local", async () => {
    beat(r.reg, "own", "192.168.87.10");
    const fred = (await r.call("fred@x", "GET", "/engines")).body as {
      id: string;
      access: string;
    }[];
    expect(fred.map((e) => [e.id, e.access])).toEqual([["own", "owner"]]);
  });

  it("needs no owner at all", async () => {
    beat(r.reg, "bare", "127.0.0.1");
    const res = await r.call("fred@x", "POST", "/engine/select", {
      id: "bare",
      token: "tok-bare",
      project: null,
    });
    expect(res.status).toBe(200);
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
    // The relay dials where the heartbeat came from, so the engine is the backend machine's own here.
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

  // The owner, shared and everyone cases go through the same `engineRole` the routes above test.
  it("hands the token of an engine on this machine to every signed-in account, owned or not", async () => {
    expect((await whoami("eve@x")).token).toBe("tok");
    reg.owners.assign("e1", "ann@x");
    expect((await whoami("eve@x")).token).toBe("tok");
  });

  it("never to an anonymous ticket", async () => {
    expect(await whoami("")).toEqual({ type: "whoami", id: "e1" });
  });
});
