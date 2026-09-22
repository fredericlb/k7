import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// `$STUDIO_HOME` is the seam, and the documented one: it is what a dev session and the WSL
// bridge already use, so the road under test is the road that runs.
const { DEFAULT_STUDIO_URL, mediatekUrlFor, resolveRegistryUrls } =
  await import("./registryClient.ts");

// Every hosted service holds its OWN registry, so an engine must heartbeat to all of them to be pickable in all of them.

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
  it("falls back to the hosted studio when nothing local is advertised", () => {
    expect(resolveRegistryUrls()).toEqual([DEFAULT_STUDIO_URL]);
  });

  it("announces to EVERY service that advertised, not just one", () => {
    // The whole bug in one assertion: three registries, three heartbeats.
    advertise("st0", "http://localhost:8789");
    advertise("pl8", "http://localhost:8795");
    advertise("m9", "http://localhost:8796");
    expect(resolveRegistryUrls().sort()).toEqual([
      "http://localhost:8789",
      "http://localhost:8795",
      "http://localhost:8796",
    ]);
  });

  it("still reads the legacy single file, and does not list it twice", () => {
    // Both are kept so a version skew between backend and tray cannot cost an app its engine.
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "web-endpoint.json"),
      JSON.stringify({ url: "http://localhost:8789" }),
    );
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
    advertise("st0", "http://localhost:8789"); // the same service, both ways
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("survives a file half-written by a backend booting right now", () => {
    // Three backends boot together under `npm run dev`, so a truncated read must cost one service's URL for a tick, not the resolution.
    advertise("st0", "http://localhost:8789");
    mkdirSync(endpoints(), { recursive: true });
    writeFileSync(join(endpoints(), "pl8.json"), '{"url":');
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("ignores anything that is not an endpoint file", () => {
    advertise("st0", "http://localhost:8789");
    writeFileSync(join(endpoints(), "notes.txt"), "http://nope");
    writeFileSync(join(endpoints(), "empty.json"), JSON.stringify({ url: "" }));
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("lets the pinned choice and the env var win outright, as tiers not a union", () => {
    // A deliberate choice beats an ambient one — the advertised files must not leak in beside it.
    advertise("st0", "http://localhost:8789");
    expect(resolveRegistryUrls(["https://studio.example"])).toEqual([
      "https://studio.example",
    ]);
    process.env.STUDIO_REGISTRY_URL = "https://a.example, https://b.example";
    expect(resolveRegistryUrls()).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });
});

describe("which médiathèque this machine caches", () => {
  it("is pl8's own subdomain, off the registry's origin", () => {
    // Never configured; the registry URL's own path is DROPPED and pl8's label put on instead, whichever of the two shapes it arrived in.
    expect(mediatekUrlFor(["https://studio.frediver.se"])).toBe(
      "https://play.studio.frediver.se",
    );
    expect(mediatekUrlFor(["https://st0.priv.frediver.se/pl8"])).toBe(
      "https://play.st0.priv.frediver.se",
    );
  });

  it("takes the first registry that is a URL at all", () => {
    // A pinned list is hand-editable and can hold junk; a machine pinned to several studios caches from the one it announces to first.
    expect(
      mediatekUrlFor([
        "not a url",
        "https://b.example/m9",
        "https://c.example",
      ]),
    ).toBe("https://play.b.example");
  });

  it("answers nothing when nothing resolves, rather than guessing", () => {
    // The local folder is then a cache of nothing, which is a working state.
    expect(mediatekUrlFor([])).toBeNull();
  });
});

// A sanity check on the seam itself: a test that silently read the real state dir would pass or fail on whatever this machine has.
it("reads the temp state dir, not the real one", () => {
  expect(process.env.STUDIO_HOME).toBe(dir);
  expect(endpoints().startsWith(dir)).toBe(true);
});
