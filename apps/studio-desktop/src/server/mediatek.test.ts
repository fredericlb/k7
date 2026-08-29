// The panel should show what this machine has rather than nothing. Two things beyond "it
// forwards": a song must stay SEEKABLE (an <audio> element asks for a byte range, and a proxy
// that swallowed it would make the track unscrubbable), and an upload must still be refused,
// because there is nowhere for it to go.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalServer } from "./index.ts";

let home: string;
let local: Awaited<ReturnType<typeof startLocalServer>>;
let fileService: Server;
let seen: { url: string; headers: Record<string, string | undefined> }[] = [];
const saved = process.env.STUDIO_HOME;
let nextPort = 39200;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "desk-mt-"));
  process.env.STUDIO_HOME = home;
  seen = [];
  const dist = join(home, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>st0</title>",
    "utf8",
  );

  const filePort = (nextPort += 5);
  fileService = await new Promise<Server>((resolve) => {
    const s = createServer((req, res) => {
      seen.push({
        url: req.url ?? "",
        headers: {
          user: req.headers["x-studio-user"] as string | undefined,
          token: req.headers["x-studio-engine-token"] as string | undefined,
          range: req.headers.range,
        },
      });
      if (req.url?.startsWith("/mediatek/file")) {
        res.writeHead(206, {
          "content-type": "audio/wav",
          "content-range": "bytes 10-19/999",
          "accept-ranges": "bytes",
        });
        return res.end("0123456789");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ songs: [{ path: "a.wav" }] }));
    });
    s.listen(filePort, "127.0.0.1", () => resolve(s));
  });

  local = await startLocalServer({
    port: filePort + 1,
    distDir: dist,
    host: "127.0.0.1",
    cache: () => ({ filePort, engineToken: "eng-tok", user: "fred@localhost" }),
  });
});

afterEach(async () => {
  await local.close();
  fileService.closeAllConnections();
  await new Promise<void>((r) => fileService.close(() => r()));
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

describe("the médiathèque, offline", () => {
  it("lists what this machine has, instead of nothing", async () => {
    const r = await fetch(`${local.url}/pl8/api/mediatek/list?family=songs`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ songs: [{ path: "a.wav" }] });
    // Same query, the file service's own prefix.
    expect(seen[0]?.url).toBe("/mediatek/list?family=songs");
  });

  it("carries the engine token and the user, which is what the file service gates on", async () => {
    await fetch(`${local.url}/pl8/api/mediatek/list`);
    expect(seen[0]?.headers.token).toBe("eng-tok");
    expect(seen[0]?.headers.user).toBe("fred@localhost");
  });

  it("keeps a song SEEKABLE — the range goes out and the content-range comes back", async () => {
    const r = await fetch(`${local.url}/pl8/api/mediatek/file?path=a.wav`, {
      headers: { range: "bytes=10-19" },
    });
    expect(seen[0]?.headers.range).toBe("bytes=10-19");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 10-19/999");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await r.text()).toBe("0123456789");
  });

  it("answers search and revision too, since the panel polls both", async () => {
    expect(
      (await fetch(`${local.url}/pl8/api/mediatek/search?q=x`)).status,
    ).toBe(200);
    expect((await fetch(`${local.url}/pl8/api/mediatek/revision`)).status).toBe(
      200,
    );
  });

  it("still refuses an UPLOAD: there is nowhere for it to go", async () => {
    const r = await fetch(`${local.url}/pl8/api/mediatek/song?filename=a.wav`, {
      method: "POST",
    });
    expect(r.status).toBe(503);
    expect(seen).toHaveLength(0);
  });

  it("leaves routes it does not serve to the shim, rather than inventing one", async () => {
    const r = await fetch(`${local.url}/pl8/api/mediatek/manifest`);
    expect(r.status).toBe(503);
    expect(seen).toHaveLength(0);
  });

  it("answers the shim's sentence when the file service itself is down", async () => {
    fileService.closeAllConnections();
    await new Promise<void>((r) => fileService.close(() => r()));
    const r = await fetch(`${local.url}/pl8/api/mediatek/list`);
    expect(r.status).toBe(503);
    expect((await r.json()) as { error: string }).toHaveProperty("error");
  });
});
