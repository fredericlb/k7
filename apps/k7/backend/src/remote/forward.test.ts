import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deviceDoor } from "./door.ts";
import { forwardToPairedServer, SERVER_PATH } from "./forward.ts";

type Listening = { url: string; close: () => void };

function listen(app: express.Express): Promise<Listening> {
  return new Promise((done) => {
    const s = app.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      done({ url: `http://127.0.0.1:${port}`, close: () => s.close() });
    });
  });
}

let server: Listening;
let tray: Listening;
let token = "good";

beforeAll(async () => {
  // The server: the door, then a route answering who it took the caller for and what it was sent.
  const s = express();
  s.use(express.json());
  s.use((req, _res, next) => {
    (req as unknown as { session: unknown }).session = {};
    next();
  });
  s.use(
    deviceDoor({
      deviceUser: (t) =>
        t === "good" ? { email: "fred@example.com", person: "sub-1" } : null,
      startSession: (req, user) => {
        (req as unknown as { user: unknown }).user = user;
      },
    }),
  );
  s.all("/api/songs/echo", (req, res) => {
    res.setHeader("x-seen", "yes");
    res.json({
      user: (req as unknown as { user: unknown }).user,
      method: req.method,
      query: req.query,
      authorization: req.get("authorization") ?? null,
      cookie: req.get("cookie") ?? null,
      body: req.body,
    });
  });
  server = await listen(s);

  // The tray: the forward, behind its JSON parser as in server.ts.
  const t = express();
  t.use(express.json());
  t.use(
    SERVER_PATH,
    forwardToPairedServer(() =>
      token === "none" ? null : { base: server.url, token },
    ),
  );
  tray = await listen(t);
});

afterAll(() => {
  tray.close();
  server.close();
});

describe("forwardToPairedServer through the device door", () => {
  it("reaches the route as the token's person, the page's own headers carried and its cookie not", async () => {
    token = "good";
    const res = await fetch(`${tray.url}${SERVER_PATH}/api/songs/echo?x=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer page-ticket",
        cookie: "studio.sid=local",
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-seen")).toBe("yes");
    expect(await res.json()).toEqual({
      user: {
        sub: "sub-1",
        email: "fred@example.com",
        name: "fred@example.com",
      },
      method: "POST",
      query: { x: "1" },
      authorization: "Bearer page-ticket",
      cookie: null,
      body: { a: 1 },
    });
  });

  it("answers 503 unpaired when the account has no server", async () => {
    token = "none";
    const res = await fetch(`${tray.url}${SERVER_PATH}/api/songs/echo`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { reason?: string }).reason).toBe("unpaired");
  });

  it("passes the door's 401 back for a token the server does not know", async () => {
    token = "stale";
    const res = await fetch(`${tray.url}${SERVER_PATH}/api/songs/echo`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { reason?: string }).reason).toBe("repair");
  });
});
