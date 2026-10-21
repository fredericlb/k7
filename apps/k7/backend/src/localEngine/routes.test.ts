// routes.test.ts — the machine's engine over HTTP, against a fake host: the allow-list, the pushed snapshot,
// and the tray's bearer.

import type { AddressInfo } from "node:net";
import { EMPTY_SNAPSHOT } from "@studio/supervisor-host/hostProtocol";
import express, { type RequestHandler } from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalEngine, LocalEngineState } from "./host.ts";
import { localEngineRouter, trayRouter } from "./routes.ts";

const sent: [string, string | undefined][] = [];
let state: LocalEngineState = { snapshot: null, down: null };
const listeners = new Set<(s: LocalEngineState) => void>();
const fake: LocalEngine = {
  state: () => state,
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  send: (cmd, arg) => void sent.push([cmd, arg]),
  start() {},
  stop: async () => {},
};
const push = (s: LocalEngineState) => {
  state = s;
  for (const l of listeners) l(s);
};

let signedIn = true;
const requireAuth: RequestHandler = (_req, res, next) =>
  signedIn ? next() : void res.status(401).end();

let base = "";
let close = () => {};
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/local/engine", localEngineRouter(fake, requireAuth));
  app.use("/api/local/tray", trayRouter(fake, "tray-secret"));
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

const cmd = (body: unknown) =>
  fetch(`${base}/api/local/engine/cmd`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/local/engine", () => {
  it("passes an allowed command and refuses the rest", async () => {
    expect((await cmd({ cmd: "engine.restart" })).status).toBe(200);
    expect((await cmd({ cmd: "audio.priority", arg: "A\u001fB" })).status).toBe(
      200,
    );
    expect((await cmd({ cmd: "shutdown" })).status).toBe(400);
    expect((await cmd({ cmd: "pair.approve", arg: "x" })).status).toBe(400);
    expect((await cmd({ cmd: "engine.start", arg: 3 })).status).toBe(400);
    expect(sent).toEqual([
      ["engine.restart", undefined],
      ["audio.priority", "A\u001fB"],
    ]);
  });

  it("answers nobody signed out", async () => {
    signedIn = false;
    expect((await fetch(`${base}/api/local/engine`)).status).toBe(401);
    signedIn = true;
  });

  it("pushes the snapshot as it changes", async () => {
    const r = await fetch(`${base}/api/local/engine/events`);
    const reader = r.body!.getReader();
    const frames: LocalEngineState[] = [];
    let buf = "";
    const read = async () => {
      while (frames.length < 2) {
        const { value } = await reader.read();
        buf += new TextDecoder().decode(value);
        for (const m of buf.matchAll(/data: (.*)\n\n/g))
          if (frames.length < 2) frames.push(JSON.parse(m[1]));
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      }
    };
    const done = read();
    await new Promise((res) => setTimeout(res, 50));
    push({ snapshot: { ...EMPTY_SNAPSHOT, status: "running" }, down: null });
    await done;
    await reader.cancel();
    expect(frames[0].snapshot).toBeNull();
    expect(frames[1].snapshot?.status).toBe("running");
  });
});

describe("/api/local/tray", () => {
  it("answers the tray's bearer only", async () => {
    expect((await fetch(`${base}/api/local/tray`)).status).toBe(401);
    const r = await fetch(`${base}/api/local/tray`, {
      headers: { authorization: "Bearer tray-secret" },
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { line: string }).line).toContain("running");
  });
});
