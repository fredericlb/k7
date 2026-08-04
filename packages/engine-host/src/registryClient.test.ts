import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `studioDir()` is `homedir()/.studio` with no env override, so the home directory IS the seam.
// Mocked before the import below, because paths.ts reads it at call time through this module.
let home = "";
vi.mock("node:os", async (real) => {
  const os = await real<typeof import("node:os")>();
  return { ...os, homedir: () => home || os.homedir() };
});

const { DEFAULT_STUDIO_URL, mediatekUrlFor, resolveRegistryUrls } =
  await import("./registryClient.ts");

// Every hosted service holds its OWN registry, so an engine must heartbeat to all of them to be
// pickable in all of them. Only l8 ever wrote the single `web-endpoint.json`, so the engine
// announced to l8 alone and the médiathèque and the decks listed nothing — the bug this pins.

let dir: string;
const endpoints = () => join(dir, ".studio", "web-endpoints");
const advertise = (service: string, url: string) => {
  mkdirSync(endpoints(), { recursive: true });
  writeFileSync(join(endpoints(), `${service}.json`), JSON.stringify({ url }));
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-registry-"));
  home = dir;
  delete process.env.STUDIO_REGISTRY_URL;
});
afterEach(() => {
  home = "";
  rmSync(dir, { recursive: true, force: true });
});

describe("where an engine announces itself", () => {
  it("falls back to the hosted studio when nothing local is advertised", () => {
    expect(resolveRegistryUrls()).toEqual([DEFAULT_STUDIO_URL]);
  });

  it("announces to EVERY service that advertised, not just one", () => {
    // The whole bug in one assertion: three registries, three heartbeats.
    advertise("l8", "http://localhost:8789");
    advertise("st0", "http://localhost:8795");
    advertise("m9", "http://localhost:8796");
    expect(resolveRegistryUrls().sort()).toEqual([
      "http://localhost:8789",
      "http://localhost:8795",
      "http://localhost:8796",
    ]);
  });

  it("still reads the legacy single file, and does not list it twice", () => {
    // A l8 backend built before `web-endpoints/` writes only that one; a tray built before
    // it reads only that one. Both are kept so version skew cannot cost an app its engine.
    mkdirSync(join(dir, ".studio"), { recursive: true });
    writeFileSync(
      join(dir, ".studio", "web-endpoint.json"),
      JSON.stringify({ url: "http://localhost:8789" }),
    );
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
    advertise("l8", "http://localhost:8789"); // the same service, both ways
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("survives a file half-written by a backend booting right now", () => {
    // Three backends boot together under `npm run dev`; a truncated read must cost that one
    // service's URL for a tick, not the whole resolution.
    advertise("l8", "http://localhost:8789");
    mkdirSync(endpoints(), { recursive: true });
    writeFileSync(join(endpoints(), "st0.json"), '{"url":');
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("ignores anything that is not an endpoint file", () => {
    advertise("l8", "http://localhost:8789");
    writeFileSync(join(endpoints(), "notes.txt"), "http://nope");
    writeFileSync(join(endpoints(), "empty.json"), JSON.stringify({ url: "" }));
    expect(resolveRegistryUrls()).toEqual(["http://localhost:8789"]);
  });

  it("lets the pinned choice and the env var win outright, as tiers not a union", () => {
    // A deliberate choice beats an ambient one — the advertised files must not leak in beside it.
    advertise("l8", "http://localhost:8789");
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
  it("is the registry's own origin, and st0 sits AT it", () => {
    // Never configured: one origin serves every service, so the registry a machine already
    // announces to carries the only thing that varies. Asking for it twice is how a machine
    // ends up heartbeating to one studio and syncing from another.
    //
    // st0's SERVICE_PATHS entry is "", so the answer is the bare origin — no trailing
    // slash, which is what `remoteLibrary` assumes when it appends `/api/mediatek`.
    expect(mediatekUrlFor(["https://studio.frediver.se/l8"])).toBe(
      "https://studio.frediver.se",
    );
    expect(mediatekUrlFor(["https://studio.test/l8"])).toBe(
      "https://studio.test",
    );
  });

  it("takes the first registry that is a URL at all", () => {
    // A pinned list can hold junk — it is hand-editable — and a machine pinned to several
    // studios caches from the one it announces to first.
    expect(
      mediatekUrlFor([
        "not a url",
        "https://b.example/m9",
        "https://c.example",
      ]),
    ).toBe("https://b.example");
  });

  it("answers nothing when nothing resolves, rather than guessing", () => {
    // The local folder is then a cache of nothing, which is a working state.
    expect(mediatekUrlFor([])).toBeNull();
  });
});

// A sanity check on the mock itself: a test that silently read the real ~/.studio would pass
// or fail on whatever this machine happens to have, which is worse than not testing at all.
it("reads the temp home, not the real one", () => {
  expect(home).not.toBe(homedir.toString());
  expect(endpoints().startsWith(dir)).toBe(true);
});
