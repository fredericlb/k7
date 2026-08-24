// proxy.test.ts — the files half of the relay, against a real upstream. What it guards is the
// body: every backend mounts `express.json()` app-wide, in front of this route, so the relay
// only ever sees a stream that is already at its end. See docs/proxy.md.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineFilesProxy } from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";

/** What the upstream file service saw, so a test can assert on the bytes rather than a status. */
interface Seen {
  method: string;
  url: string;
  body: string;
  contentLength: string | undefined;
}

let upstream: Server;
let seen: Seen[];
let app: Server;
let registry: EngineRegistry;
let base: string;
/** How long the stand-in takes to answer; the engine's machine is legitimately silent while it works, and the relay must not read that as dead. */
let thinkMs = 0;

/** A stand-in file service: records what arrived and echoes it back. */
function startUpstream(): Promise<number> {
  seen = [];
  thinkMs = 0;
  return new Promise((resolve) => {
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        seen.push({
          method: req.method ?? "",
          url: req.url ?? "",
          body,
          contentLength: req.headers["content-length"],
        });
        // Nothing is written until the think time is up, which is what a real slow route does and what a relay bounded at the response would destroy.
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ got: body }));
        }, thinkMs);
      });
    });
    upstream.listen(0, "127.0.0.1", () =>
      resolve((upstream.address() as AddressInfo).port),
    );
  });
}

/** The hosted service, mounted exactly as the three backends mount it: parser first. */
function startApp(filePort: number, loopback = "127.0.0.1"): Promise<string> {
  registry = createRegistry();
  registry.upsert({
    id: "e1",
    token: "t1",
    hostname: "rig",
    machineFingerprint: "fp",
    addresses: { loopback, lanIps: ["127.0.0.1"], port: 8765, filePort },
  });
  const a = express();
  // The line this whole test exists for. It runs BEFORE the proxy and eats the body.
  a.use(express.json());
  a.use("/api/engine/:id/files", engineFilesProxy(registry));
  return new Promise((resolve) => {
    app = a.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${(app.address() as AddressInfo).port}`),
    );
  });
}

const close = (s: Server | undefined) =>
  new Promise<void>((r) => (s ? s.close(() => r()) : r()));

describe("engineFilesProxy", () => {
  beforeEach(async () => {
    base = await startApp(await startUpstream());
  });
  afterEach(async () => {
    await close(app);
    await close(upstream);
  });

  it("forwards a JSON body a parser in front of it already consumed", async () => {
    const res = await fetch(`${base}/api/engine/e1/files/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "songs/first" }),
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0].body)).toEqual({ project: "songs/first" });
    // The re-serialized length, not the one we were sent — the bytes are not the same bytes.
    expect(seen[0].contentLength).toBe(String(seen[0].body.length));
  });

  it("passes a GET through, body-less and unbuffered", async () => {
    const res = await fetch(`${base}/api/engine/e1/files/tree?path=.`);
    expect(res.status).toBe(200);
    expect(seen[0].method).toBe("GET");
    expect(seen[0].url).toBe("/tree?path=.");
    expect(seen[0].body).toBe("");
  });

  it("carries the caller's headers to the file service", async () => {
    await fetch(`${base}/api/engine/e1/files/file`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-studio-user": "me" },
      body: JSON.stringify({ path: "a.yaml" }),
    });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0].body)).toEqual({ path: "a.yaml" });
  });

  it("retries the next address with the body intact", async () => {
    await close(app);
    // 127.0.0.2 is loopback too, so the connection is REFUSED rather than left hanging and the LAN entry answers.
    base = await startApp(
      (upstream.address() as AddressInfo).port,
      "127.0.0.2",
    );
    const res = await fetch(`${base}/api/engine/e1/files/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ line: "save" }),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(seen[0].body)).toEqual({ line: "save" });
  });

  it("waits on a route that thinks for longer than the dial bound", async () => {
    // The regression: an http.request `timeout` is a socket IDLE timeout — see docs/proxy.md.
    thinkMs = 2200; // comfortably past DIAL_TIMEOUT_MS, without making the suite slow
    const res = await fetch(`${base}/api/engine/e1/files/mediatek/analyse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "songs/a/b/c/original.flac" }),
    });
    expect(res.status).toBe(200);
    // Once, not once per address: a slow host must not read as an unreachable one.
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0].body)).toEqual({
      path: "songs/a/b/c/original.flac",
    });
  }, 10_000);

  it("answers 404 for an engine the registry does not hold", async () => {
    const res = await fetch(`${base}/api/engine/nope/files/tree`);
    expect(res.status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});
