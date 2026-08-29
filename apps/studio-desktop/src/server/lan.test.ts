// A second device gets the static app, the engine registry, and the ONE thing it needs to
// agree with this machine about a project's address. Not the account credential, and not the
// git remotes. Where a LAN address exists these run against the real socket, which is the only
// way `req.socket.remoteAddress` is exercised at all.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalServer } from "./index.ts";
import { lanMayRead, redactForLan } from "./remote.ts";

/** This machine's first non-loopback IPv4, or null on a host that has none (a bare container). */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

const LAN = lanAddress();

const REGISTER = {
  repos: [
    {
      id: "r1",
      uri: "ssh://git@192.168.87.10:6611/music/lemo_mante.git",
      name: "lemo_mante",
      label: "Lemo Mante",
      addedAt: "2026-01-01",
    },
  ],
  revision: "rev-7",
};

describe("the LAN policy, as a rule", () => {
  it("lets a second device READ the register, and nothing else", () => {
    expect(lanMayRead("GET", "/pl8/api/projects")).toBe(true);
    expect(lanMayRead("GET", "/pl8/api/projects/revision")).toBe(true);
    for (const [m, p] of [
      ["POST", "/pl8/api/projects"],
      ["DELETE", "/pl8/api/projects/r1"],
      ["GET", "/pl8/api/projects/ssh-key"],
      ["GET", "/pl8/api/projects/libraries"],
      ["GET", "/pl8/api/shares"],
      ["GET", "/pl8/api/mediatek/list"],
      ["GET", "/pl8/api/projects/by-name/x"],
    ] as const) {
      expect(lanMayRead(m, p), `${m} ${p}`).toBe(false);
    }
  });

  it("blanks the git URI, which is the host, port and path", () => {
    const out = JSON.parse(
      redactForLan(Buffer.from(JSON.stringify(REGISTER))).toString(),
    ) as typeof REGISTER;
    expect(out.repos[0]?.uri).toBe("");
    // The NAME survives: it is the half of an address a person reads, and the whole reason
    // the second device is allowed to ask at all.
    expect(out.repos[0]?.name).toBe("lemo_mante");
    expect(out.revision).toBe("rev-7");
  });

  it("answers an empty register rather than passing a body it could not read", () => {
    const out = JSON.parse(
      redactForLan(Buffer.from("not json")).toString(),
    ) as {
      repos: unknown[];
    };
    expect(out.repos).toEqual([]);
  });
});

describe.skipIf(LAN === null)("a second device, over the real socket", () => {
  let home: string;
  let local: Awaited<ReturnType<typeof startLocalServer>>;
  let upstream: Server;
  const saved = process.env.STUDIO_HOME;
  let nextPort = 39300;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "desk-lan-"));
    process.env.STUDIO_HOME = home;
    const dist = join(home, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(
      join(dist, "index.html"),
      "<!doctype html><title>st0</title>",
      "utf8",
    );

    const upPort = (nextPort += 5);
    upstream = await new Promise<Server>((resolve) => {
      const s = createServer((_q, r) => {
        r.setHeader("content-type", "application/json");
        r.end(JSON.stringify(REGISTER));
      });
      s.listen(upPort, "127.0.0.1", () => resolve(s));
    });

    local = await startLocalServer({
      port: upPort + 1,
      distDir: dist,
      // The whole point: reachable from the LAN, like the file service already is.
      host: "0.0.0.0",
      remote: () => ({
        serverUrl: `http://127.0.0.1:${upPort}`,
        serverToken: "tok-secret",
      }),
    });
  });

  afterEach(async () => {
    await local.close();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
    if (saved === undefined) delete process.env.STUDIO_HOME;
    else process.env.STUDIO_HOME = saved;
    rmSync(home, { recursive: true, force: true });
  });

  const asLan = (p: string, init?: RequestInit) =>
    fetch(`http://${LAN}:${local.port}${p}`, init);

  it("gets the app itself", async () => {
    expect((await asLan("/external")).status).toBe(200);
    expect(await (await asLan("/external")).text()).toContain(
      "<title>st0</title>",
    );
  });

  it("sees the SAME repo names this machine does — or the two claim one song twice", async () => {
    const mine = (await (
      await fetch(`${local.url}/pl8/api/projects`)
    ).json()) as typeof REGISTER;
    const theirs = (await (
      await asLan("/pl8/api/projects")
    ).json()) as typeof REGISTER;
    expect(theirs.repos.map((r) => r.name)).toEqual(
      mine.repos.map((r) => r.name),
    );
  });

  it("does NOT see the git remote, which this machine does", async () => {
    const mine = (await (
      await fetch(`${local.url}/pl8/api/projects`)
    ).json()) as typeof REGISTER;
    const theirs = (await (
      await asLan("/pl8/api/projects")
    ).json()) as typeof REGISTER;
    expect(mine.repos[0]?.uri).toContain("ssh://");
    expect(theirs.repos[0]?.uri).toBe("");
  });

  it("cannot reach anything else on the account", async () => {
    for (const p of [
      "/pl8/api/shares",
      "/pl8/api/projects/ssh-key",
      "/pl8/api/mediatek/list",
    ]) {
      const r = await asLan(p);
      // The shim answers, not the server: no bearer ever left this machine for these.
      expect([200, 503], p).toContain(r.status);
      expect(await r.text(), p).not.toContain("ssh://");
    }
  });

  it("cannot WRITE, whatever it asks", async () => {
    const r = await asLan("/pl8/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uri: "ssh://git@evil/x.git" }),
    });
    expect(r.status).toBe(503);
  });
});
