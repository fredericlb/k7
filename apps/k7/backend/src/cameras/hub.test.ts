import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  CAMERAS_WS_PATH,
  type CameraFrame,
} from "@studio/web-protocol/cameras";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { CameraHub } from "./hub.ts";
import { cameraTickets, iceServersFromEnv } from "./ticket.ts";

const tickets = cameraTickets();
const hub = new CameraHub(tickets, { cameras: 2 });
let server: Server;
let base: string;
let detach: () => void;

beforeAll(async () => {
  server = createServer((_req, res) => res.end());
  detach = hub.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${CAMERAS_WS_PATH}`;
});
afterAll(async () => {
  detach();
  await new Promise((r) => server.close(r));
});

/** A socket, and the frames it receives in order, awaited one at a time. */
function open(account: string, query: string) {
  const ws = new WebSocket(`${base}?ticket=${tickets.issue(account)}&${query}`);
  const queue: CameraFrame[] = [];
  const waiting: ((f: CameraFrame) => void)[] = [];
  ws.on("message", (d) => {
    const f = JSON.parse(String(d)) as CameraFrame;
    const w = waiting.shift();
    if (w) w(f);
    else queue.push(f);
  });
  return {
    ws,
    ready: new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    }),
    next: () =>
      new Promise<CameraFrame>((r) => {
        const f = queue.shift();
        if (f) r(f);
        else waiting.push(r);
      }),
    send: (f: CameraFrame) => ws.send(JSON.stringify(f)),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

describe("tickets", () => {
  it("binds an account and refuses a forgery", () => {
    expect(tickets.verify(tickets.issue("ana"))).toBe("ana");
    expect(
      tickets.verify(`${tickets.issue("ana").split(".")[0]}.x`),
    ).toBeNull();
    expect(cameraTickets().verify(tickets.issue("ana"))).toBeNull();
  });
  it("reads ICE servers as URLs or JSON", () => {
    expect(iceServersFromEnv("stun:a:3478, stun:b")).toEqual([
      { urls: "stun:a:3478" },
      { urls: "stun:b" },
    ]);
    expect(
      iceServersFromEnv('[{"urls":"turn:t","username":"u","credential":"c"}]'),
    ).toHaveLength(1);
    expect(iceServersFromEnv(undefined)).toEqual([]);
  });
});

describe("CameraHub", () => {
  it("refuses an upgrade without a ticket", async () => {
    const ws = new WebSocket(`${base}?role=viewer`);
    const status = await new Promise<number | undefined>((r) =>
      ws.on("unexpected-response", (_req, res) => r(res.statusCode)),
    );
    expect(status).toBe(401);
  });

  it("lists a camera under a unique name, to its own account only", async () => {
    const a = open("ana", "role=camera&name=iPad");
    await a.ready;
    expect(await a.next()).toEqual({ type: "hello", name: "iPad" });
    const b = open("ana", "role=camera&name=ipad");
    await b.ready;
    expect(await b.next()).toEqual({ type: "hello", name: "ipad (2)" });
    expect(hub.list("ana").map((c) => c.name)).toEqual(["iPad", "ipad (2)"]);
    expect(hub.list("bob")).toEqual([]);
    // The per-account cap.
    const c = new WebSocket(
      `${base}?ticket=${tickets.issue("ana")}&role=camera&name=x`,
    );
    const status = await new Promise<number | undefined>((r) =>
      c.on("unexpected-response", (_req, res) => r(res.statusCode)),
    );
    expect(status).toBe(429);
    a.ws.close();
    b.ws.close();
    await settle();
    expect(hub.list("ana")).toEqual([]);
  });

  it("carries a viewer's negotiation to the camera it named, and back", async () => {
    const cam = open("ana", "role=camera&name=Stage");
    await cam.ready;
    await cam.next(); // hello
    const viewer = open("ana", "role=viewer");
    await viewer.ready;
    viewer.send({ type: "want", label: "remote:stage" });
    const want = await cam.next();
    expect(want).toMatchObject({ type: "want", label: "remote:stage" });
    const from = (want as { from: string }).from;
    expect(await cam.next()).toEqual({ type: "viewers", count: 1 });
    cam.send({ type: "offer", to: from, sdp: { type: "offer", sdp: "o" } });
    expect(await viewer.next()).toEqual({
      type: "offer",
      sdp: { type: "offer", sdp: "o" },
      problem: null,
    });
    viewer.send({ type: "answer", sdp: { type: "answer", sdp: "a" } });
    expect(await cam.next()).toEqual({
      type: "answer",
      sdp: { type: "answer", sdp: "a" },
      from,
    });
    viewer.ws.close();
    expect(await cam.next()).toEqual({ type: "gone", from });
    expect(await cam.next()).toEqual({ type: "viewers", count: 0 });
    cam.ws.close();
    await settle();
  });

  it("never pairs a viewer with another account's camera", async () => {
    const cam = open("bob", "role=camera&name=Bob cam");
    await cam.ready;
    await cam.next();
    const viewer = open("ana", "role=viewer");
    await viewer.ready;
    viewer.send({ type: "want", label: "remote:Bob cam" });
    expect(await viewer.next()).toEqual({
      type: "problem",
      text: "no remote camera is on",
    });
    viewer.ws.close();
    cam.ws.close();
    await settle();
  });
});
