// Where this service decides the hosted library is. The case that matters is the one nothing
// covered: a checkout, where the dev session starts this service directly and the supervisor —
// which is what passes MEDIATEK_URL and MEDIATEK_TOKEN — never gets to.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";

let home: string;
let real: { HOME?: string; USERPROFILE?: string; URL?: string; TOK?: string };

/** Both HOME and USERPROFILE: `homedir()` reads one or the other. */
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fs-link-home-"));
  real = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    URL: process.env.MEDIATEK_URL,
    TOK: process.env.MEDIATEK_TOKEN,
  };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.MEDIATEK_URL;
  delete process.env.MEDIATEK_TOKEN;
  mkdirSync(join(home, ".studio", "web-endpoints"), { recursive: true });
});

afterEach(() => {
  for (const [k, v] of [
    ["HOME", real.HOME],
    ["USERPROFILE", real.USERPROFILE],
    ["MEDIATEK_URL", real.URL],
    ["MEDIATEK_TOKEN", real.TOK],
  ] as const)
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

const advertise = (service: string, url: string) =>
  writeFileSync(
    join(home, ".studio", "web-endpoints", `${service}.json`),
    JSON.stringify({ service, url }),
    "utf8",
  );

const settings = (body: unknown) =>
  writeFileSync(
    join(home, ".studio", "engine-tray.json"),
    JSON.stringify(body),
    "utf8",
  );

describe("mediatekBase", () => {
  it("takes the environment the supervisor spawned us with", () => {
    process.env.MEDIATEK_URL = "https://studio.frediver.se";
    advertise("pl8", "http://localhost:8795");
    expect(mediatekBase()).toBe("https://studio.frediver.se");
  });

  it("falls back to the médiathèque's OWN advertised port, not a neighbour's", () => {
    // In dev each backend advertises its own port, so "whichever registry answered first" is st0's 8789.
    advertise("st0", "http://localhost:8789");
    advertise("pl8", "http://localhost:8795");
    expect(mediatekBase()).toBe("http://localhost:8795");
  });

  it("is null when nothing on this machine is the library", () => {
    advertise("st0", "http://localhost:8789");
    expect(mediatekBase()).toBeNull();
  });

  it("is null with no ~/.studio at all", () => {
    rmSync(join(home, ".studio"), { recursive: true, force: true });
    expect(mediatekBase()).toBeNull();
  });

  it("ignores a half-written endpoint file rather than throwing", () => {
    writeFileSync(
      join(home, ".studio", "web-endpoints", "pl8.json"),
      '{"service":"pl8","url":',
      "utf8",
    );
    expect(mediatekBase()).toBeNull();
  });
});

describe("mediatekToken", () => {
  it("takes the environment first", () => {
    process.env.MEDIATEK_TOKEN = "from-env";
    settings({ mediatekToken: "from-disk" });
    expect(mediatekToken()).toBe("from-env");
  });

  it("reads the supervisor's settings, where `npm run tokens` puts it", () => {
    settings({ mediatekToken: "from-disk" });
    expect(mediatekToken()).toBe("from-disk");
  });

  it("is null when the settings hold no token", () => {
    settings({ port: 8765 });
    expect(mediatekToken()).toBeNull();
  });

  it("is null with no settings file", () => {
    expect(mediatekToken()).toBeNull();
  });
});
