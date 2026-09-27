// fileHub.test.ts — the hub over a FAKE file service, so what is pinned is the hub's contract
// and not the service's: the session decides who is calling, a client cannot forge it or the
// secret, each account gets its own process and home, and an engine binds only on a claim.

import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileHub } from "./index.ts";

// The stand-in: answers /health, records /hub/engine, and echoes what it was sent.
const FAKE = `
import { createServer } from "node:http";
let engine = null;
createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/health") return res.end("{}");
    if (req.url === "/hub/engine") engine = JSON.parse(body).url;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ url: req.url, headers: req.headers, body, engine,
      home: process.env.STUDIO_HOME,
      secret: process.env.STUDIO_HUB_SECRET,
      mediatek: [process.env.MEDIATEK_URL, process.env.MEDIATEK_TOKEN] }));
  });
}).listen(Number(process.env.STUDIO_FILE_PORT), "127.0.0.1");
`;

interface Echo {
  url: string;
  headers: Record<string, string>;
  body: string;
  engine: string | null;
  home: string;
  secret: string;
  mediatek: [string, string];
}

describe("the file hub", () => {
  let server: Server;
  let hub: FileHub;
  let base: string;
  let bound: { id: string; roots: unknown[]; kind: string }[];
  /** The ENGINE bindings; each comes with a jobs one for the same machine. */
  const engineBinds = () => bound.filter((b) => b.kind === "engine");
  let claims: Map<string, string[]>;

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), "file-hub-"));
    const fake = join(dir, "fake.mjs");
    writeFileSync(fake, FAKE);
    bound = [];
    claims = new Map();
    const app = express();
    app.use(express.json());
    hub = new FileHub({
      dataRoot: join(dir, "data"),
      mediatekRoot: "/library",
      mediatekLink: (user) => ({
        url: "http://pl8",
        token: `token-of-${user}`,
      }),
      command: () => ({ cmd: process.execPath, args: [fake], cwd: dir }),
      userOf: (req) => String(req.headers["x-test-session"] ?? ""),
      registry: {
        get: (id: string) =>
          claims.has(id)
            ? ({
                holders: new Map(
                  (claims.get(id) ?? []).map((h, i) => [
                    String(i),
                    { holder: h, project: null, seen: 0 },
                  ]),
                ),
              } as never)
            : undefined,
      },
      tunnels: {
        bindLocal: (id, roots, kind) => {
          bound.push({ id, roots, kind: kind ?? "engine" });
          return `/api/engine-tunnel/local/k${bound.length}`;
        },
        unbindLocal: () => {},
        openReady: async () => null,
      },
      selfPort: () => 4242,
      log: () => {},
    });
    app.get("/api/files-hub", hub.helloHandler());
    app.use("/api/files", hub.handler());
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/files`;
  });

  afterEach(async () => {
    await hub.stop();
    await new Promise((r) => server.close(r));
  });

  const call = async (
    path: string,
    init: RequestInit & { session?: string } = {},
  ) => {
    const headers = new Headers(init.headers);
    if (init.session) headers.set("x-test-session", init.session);
    const r = await fetch(`${base}${path}`, { ...init, headers });
    return { status: r.status, echo: (await r.json()) as Echo };
  };

  it("refuses a request the session names nobody for", async () => {
    expect((await call("/workspaces")).status).toBe(401);
  });

  it("stamps the SESSION's user and its own secret, whatever the client sent", async () => {
    const { echo } = await call("/workspaces?x=1", {
      session: "fred@example.com",
      headers: {
        "x-studio-user": "mallory@example.com",
        "x-studio-hub-secret": "forged",
      },
    });
    expect(echo.url).toBe("/workspaces?x=1");
    expect(echo.headers["x-studio-user"]).toBe("fred@example.com");
    expect(echo.headers["x-studio-hub-secret"]).toBe(echo.secret);
  });

  it("replays a JSON body a parser in front already consumed", async () => {
    const { echo } = await call("/file", {
      session: "fred@example.com",
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "a.yaml", text: "x" }),
    });
    expect(JSON.parse(echo.body)).toEqual({ path: "a.yaml", text: "x" });
  });

  it("gives each account its own process and home", async () => {
    const a = (await call("/x", { session: "a@example.com" })).echo;
    const a2 = (await call("/x", { session: "a@example.com" })).echo;
    const b = (await call("/x", { session: "b@example.com" })).echo;
    expect(a.secret).toBe(a2.secret);
    expect(b.secret).not.toBe(a.secret);
    expect(a.home).not.toBe(b.home);
    expect(a.home).toMatch(/a_example_com-[0-9a-f]{10}$/);
  });

  it("hands each account's service a pl8 bearer of its own", async () => {
    const a = (await call("/x", { session: "a@example.com" })).echo;
    expect(a.mediatek).toEqual(["http://pl8", "token-of-a@example.com"]);
  });

  it("keeps apart two emails that slug alike", async () => {
    const dot = (await call("/x", { session: "a.b@example.com" })).echo;
    const bar = (await call("/x", { session: "a_b@example.com" })).echo;
    expect(dot.home).not.toBe(bar.home);
    expect(dot.secret).not.toBe(bar.secret);
  });

  it("binds an engine only on a claim the account holds", async () => {
    claims.set("e1", ["someone@example.com"]);
    let echo = (
      await call("/x", {
        session: "fred@example.com",
        headers: { "x-studio-engine-id": "e1" },
      })
    ).echo;
    expect(bound).toHaveLength(0);
    expect(echo.engine).toBeNull();
    claims.set("e1", ["fred@example.com"]);
    echo = (
      await call("/x", {
        session: "fred@example.com",
        headers: { "x-studio-engine-id": "e1" },
      })
    ).echo;
    expect(engineBinds()).toHaveLength(1);
    expect(bound.map((b) => b.kind)).toEqual(["engine", "jobs"]);
    expect(echo.engine).toBe("ws://127.0.0.1:4242/api/engine-tunnel/local/k1");
    const roots = bound[0].roots as {
      remote: string;
      writable: boolean;
      name: string;
    }[];
    expect(roots[0].name).toMatch(/^ws-fred_example_com-[0-9a-f]{10}$/);
    expect(roots[0].writable).toBe(true);
    expect(
      roots[0].remote.endsWith(join(roots[0].name.slice(3), "workspace")),
    ).toBe(true);
    // The account's libraries, READ-ONLY: a module's files the engine loads live in one.
    expect(roots[1].name).toBe(`libs-${roots[0].name.slice(3)}`);
    expect(roots[1].writable).toBe(false);
    expect(
      roots[1].remote.endsWith(join(roots[0].name.slice(3), "libraries")),
    ).toBe(true);
    expect(roots[2].name).toBe(`models-${roots[0].name.slice(3)}`);
    expect(roots[2].writable).toBe(false);
    expect(roots[3]).toEqual({
      remote: "/library",
      name: "mediatek",
      writable: false,
    });
  });

  it("hands an engine from one account to the next, one at a time", async () => {
    claims.set("e1", ["fred@example.com"]);
    const drive = { "x-studio-engine-id": "e1" };
    let fred = (
      await call("/x", { session: "fred@example.com", headers: drive })
    ).echo;
    expect(fred.engine).toContain("/local/");
    claims.set("e1", ["alice@example.com"]);
    const alice = (
      await call("/x", { session: "alice@example.com", headers: drive })
    ).echo;
    expect(alice.engine).toContain("/local/");
    fred = (await call("/x", { session: "fred@example.com" })).echo;
    expect(fred.engine).toBeNull();
    expect(engineBinds().map((b) => b.id)).toEqual(["e1", "e1"]);
  });

  const hello = async (session?: string) => {
    const r = await fetch(base.replace("/api/files", "/api/files-hub"), {
      headers: session ? { "x-test-session": session } : {},
    });
    return {
      status: r.status,
      body: (await r.json()) as { path: string; ticket: string },
    };
  };

  it("mints a ticket only for a session", async () => {
    expect((await hello()).status).toBe(401);
    const { body } = await hello("fred@example.com");
    expect(body.path).toBe("/api/files");
    expect(body.ticket).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it("takes the caller from a ticket, with no session at all", async () => {
    const { ticket } = (await hello("fred@example.com")).body;
    const { status, echo } = await call("/x", {
      headers: { "x-studio-engine-token": ticket },
    });
    expect(status).toBe(200);
    expect(echo.headers["x-studio-user"]).toBe("fred@example.com");
    expect(echo.headers["x-studio-engine-token"]).toBeUndefined();
  });

  it("refuses a forged ticket", async () => {
    const { ticket } = (await hello("fred@example.com")).body;
    const claim = { u: "mallory@example.com", exp: Date.now() + 1e6 };
    const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
    const forged = `${payload}.${ticket.split(".")[1]}`;
    const r = await call("/x", {
      headers: { "x-studio-engine-token": forged },
    });
    expect(r.status).toBe(401);
  });

  it("binds the engine named after the ticket, on a claim", async () => {
    claims.set("e9", ["fred@example.com"]);
    const { ticket } = (await hello("fred@example.com")).body;
    const { echo } = await call("/x", {
      headers: { "x-studio-engine-token": `${ticket}~e9` },
    });
    expect(engineBinds().map((b) => b.id)).toEqual(["e9"]);
    expect(echo.engine).toContain("/api/engine-tunnel/local/");
  });
});
