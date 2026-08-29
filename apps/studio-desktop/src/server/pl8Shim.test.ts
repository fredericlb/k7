// The single most important check in the offline story is the LAST one here: no route under
// /pl8 may fall through to the SPA or fail the connection. Either way the gate ends up running
// its reachability probe, and that probe on a service which is plainly up always answers
// `blocked` — drawing "this page isn't allowed to reach the engine", with a CORS story, on a
// machine where nothing is wrong.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startLocalServer } from "./index.ts";

let home: string;
let url: string;
let server: Awaited<ReturnType<typeof startLocalServer>>;
const saved = process.env.STUDIO_HOME;
let nextPort = 39700;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "desk-pl8-"));
  process.env.STUDIO_HOME = home;
  const dist = join(home, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    "<!doctype html><title>st0</title>",
    "utf8",
  );
  server = await startLocalServer({
    port: (nextPort += 3),
    distDir: dist,
    host: "127.0.0.1",
  });
  url = server.url;
});

afterEach(async () => {
  await server.close();
  if (saved === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = saved;
  rmSync(home, { recursive: true, force: true });
});

const get = (p: string) => fetch(`${url}${p}`);

describe("the offline register", () => {
  it("is EMPTY, which is what makes the home page address projects as @local", async () => {
    const r = await get("/pl8/api/projects");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ repos: [], revision: "offline" });
  });

  it("keeps the revision CONSTANT, or the home page would re-ask forever", async () => {
    const a = (await (await get("/pl8/api/projects/revision")).json()) as {
      revision: string;
    };
    const b = (await (await get("/pl8/api/projects/revision")).json()) as {
      revision: string;
    };
    expect(a.revision).toBe(b.revision);
  });

  it("answers `libraries: null` with a 200 — the DESIGNED null, not a 404", async () => {
    const r = await get("/pl8/api/projects/libraries");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ libraries: null });
    // A 404 here would read as "pl8 is broken" instead of "nobody has set one".
  });

  it("404s a repo name WITH a sentence, which the gate prints on its `missing` screen", async () => {
    const r = await get("/pl8/api/projects/by-name/lemo_mante");
    // 400 and 404 are the two the gate turns into `missing`; anything else is a diagnosis.
    expect(r.status).toBe(404);
    const { error } = (await r.json()) as { error: string };
    expect(error).toContain("lemo_mante");
    expect(error).toContain("Settings");
  });

  it("answers the shares list rather than failing it", async () => {
    expect(await (await get("/pl8/api/shares")).json()).toEqual({
      shares: [],
      revision: "offline",
    });
  });

  it("has no ssh key, and says so as a value", async () => {
    expect(await (await get("/pl8/api/projects/ssh-key")).json()).toEqual({
      publicKey: null,
    });
  });
});

describe("what has no local answer", () => {
  it("refuses a WRITE with a sentence — the register is pl8's, and a copy would be a second one", async () => {
    for (const [method, path] of [
      ["POST", "/pl8/api/projects"],
      ["DELETE", "/pl8/api/projects/abc"],
      ["PUT", "/pl8/api/projects/libraries"],
      ["POST", "/pl8/api/projects/ssh-key"],
      ["DELETE", "/pl8/api/shares/tok"],
    ] as const) {
      const r = await fetch(`${url}${path}`, { method });
      expect(r.status, `${method} ${path}`).toBe(503);
      expect((await r.json()) as { error: string }).toHaveProperty("error");
    }
  });

  it("ANSWERS a route nobody listed, rather than handing back the SPA", async () => {
    // The rule has to hold for routes pl8 grows later, not just the ones written here.
    for (const path of [
      "/pl8/api/hunt",
      "/pl8/api/stems/xyz",
      "/pl8/api/whatever/deep/path",
    ]) {
      const r = await get(path);
      expect(r.status, path).toBe(503);
      expect(r.headers.get("content-type"), path).toContain("application/json");
    }
  });

  it("never lets a /pl8 fetch parse index.html as JSON", async () => {
    for (const path of ["/pl8", "/pl8/", "/pl8/api", "/pl8/anything"]) {
      const r = await get(path);
      const body = await r.text();
      expect(body, path).not.toContain("<!doctype html");
      expect(() => JSON.parse(body), path).not.toThrow();
    }
  });
});
