import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `$STUDIO_HOME` is the seam, and the documented one: every reader of the state dir
// honours it, so the road under test is the road that runs.
const { probeRegistry, resolveRegistryUrls, setRegistryFetch } = await import(
  "./registryClient.ts"
);

// ONE registry per studio family, pl8's: st0 lists its engines from there, so an engine heartbeats nowhere else.

let dir: string;
const endpoints = () => join(dir, "web-endpoints");
const advertise = (service: string, url: string) => {
  mkdirSync(endpoints(), { recursive: true });
  writeFileSync(join(endpoints(), `${service}.json`), JSON.stringify({ url }));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-registry-"));
  process.env.STUDIO_HOME = dir;
  delete process.env.STUDIO_REGISTRY_URL;
});
afterEach(() => {
  delete process.env.STUDIO_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("where an engine announces itself", () => {
  it("announces to nobody when nothing is added or set", () => {
    // A fresh machine is connected to no st0 instance: one is added from the tray's settings, never assumed.
    expect(resolveRegistryUrls()).toEqual([]);
  });

  it("ignores what local backends advertise", () => {
    // Running a dev backend must not connect the engine to it — that is the tray's st0 instances tab's job.
    advertise("st0", "http://localhost:8789");
    advertise("pl8", "http://localhost:8795");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "web-endpoint.json"),
      JSON.stringify({ url: "http://localhost:8789" }),
    );
    expect(resolveRegistryUrls()).toEqual([]);
  });

  it("reads the env var as a deduped list of pl8 registries", () => {
    process.env.STUDIO_REGISTRY_URL =
      "https://a.example, https://b.example,,https://play.a.example";
    expect(resolveRegistryUrls()).toEqual([
      "https://play.a.example",
      "https://play.b.example",
    ]);
  });

  it("lets what the user added win over the env var, as tiers not a union", () => {
    process.env.STUDIO_REGISTRY_URL = "https://a.example";
    expect(resolveRegistryUrls(["https://studio.example"])).toEqual([
      "https://play.studio.example",
    ]);
  });

  it("reads a st0 URL an older settings file pinned as its family's pl8", () => {
    // st0 no longer holds a registry: heartbeating to it would 404 forever, and its picker asks pl8 anyway.
    expect(
      resolveRegistryUrls([
        "https://st0.app",
        "https://play.st0.app",
        "http://localhost:8789",
        "not a url",
      ]),
    ).toEqual(["https://play.st0.app", "http://localhost:8795"]);
  });
});

describe("asking an address whether it is a registry", () => {
  // A heartbeat carries the engine's token, so this is the gate before any is sent — docs/supervisorPolicy.md.
  let asked: { url: string; init?: RequestInit }[];
  const answer = (make: () => Response) =>
    setRegistryFetch((async (url: string, init?: RequestInit) => {
      asked.push({ url, init });
      return make();
    }) as typeof fetch);
  beforeEach(() => {
    asked = [];
  });
  afterEach(() => setRegistryFetch(null));

  it("accepts a registry that names itself, asked at its hello path without following redirects", async () => {
    answer(() => Response.json({ service: "st0-registry" }));
    expect(await probeRegistry("https://play.st0.app/")).toEqual({ ok: true });
    expect(asked[0].url).toBe("https://play.st0.app/api/registry/hello");
    expect(asked[0].init?.redirect).toBe("error");
  });

  it("refuses a site that answers, but not as a registry", async () => {
    // What adding https://google.com met: an HTML 404 at play.google.com.
    answer(() => new Response("<html>not found</html>", { status: 404 }));
    expect(await probeRegistry("https://play.google.com")).toEqual({
      ok: false,
      why: "https://play.google.com is not an st0 instance",
    });
    answer(() => Response.json({ service: "something-else" }));
    expect((await probeRegistry("https://x.example")).ok).toBe(false);
  });

  it("refuses an address that does not answer at all", async () => {
    setRegistryFetch((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(await probeRegistry("http://localhost:8795")).toEqual({
      ok: false,
      why: "http://localhost:8795 did not answer",
    });
  });
});

// A sanity check on the seam itself: a test that silently read the real state dir would pass or fail on whatever this machine has.
it("reads the temp state dir, not the real one", () => {
  expect(process.env.STUDIO_HOME).toBe(dir);
  expect(endpoints().startsWith(dir)).toBe(true);
});
