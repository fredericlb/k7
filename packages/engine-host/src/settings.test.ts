// The settings file changed name, and a machine that has the old one must not lose its audio
// pick or its registry override — read-old/write-new, engine-client/docs/paths.md.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSettings, saveSettings } from "./settings.ts";

let state: string;

beforeEach(() => {
  // `$STUDIO_HOME` rather than a faked home: the state dir is `<library>/st0`, and faking the
  // home misses `%APPDATA%` and `$XDG_CONFIG_HOME` entirely (engine-client/docs/paths.md).
  state = mkdtempSync(join(tmpdir(), "st0-settings-"));
  process.env.STUDIO_HOME = state;
});
afterEach(() => {
  process.env.STUDIO_HOME = undefined;
  rmSync(state, { recursive: true, force: true });
});

const write = (name: string, body: unknown) =>
  writeFileSync(join(state, name), JSON.stringify(body), "utf8");

describe("where the settings are read from", () => {
  it("reads the current file", () => {
    write("engine-host.json", { port: 9001 });
    expect(loadSettings().port).toBe(9001);
  });

  it("reads ONE name, and a machine carrying only the tray's starts from defaults", () => {
    write("engine-tray.json", { port: 9002, audioPriority: ["Scarlett"] });
    const s = loadSettings();
    // Deliberate, and the whole of the migration: the tray it was named after is gone.
    expect(s.port).toBe(8765);
    expect(s.audioPriority).toEqual([]);
  });

  it("answers defaults when there is neither", () => {
    expect(loadSettings().port).toBe(8765);
  });
});

describe("where they are written", () => {
  it("writes the current name, and reads back what it wrote", () => {
    const s = loadSettings();
    saveSettings({ ...s, port: 9004 });
    expect(
      JSON.parse(readFileSync(join(state, "engine-host.json"), "utf8")).port,
    ).toBe(9004);
    expect(loadSettings().port).toBe(9004);
  });

  it("keeps every field it was given, not just the one that changed", () => {
    write("engine-host.json", {
      port: 9002,
      audioPriority: ["Scarlett"],
      webPort: 8781,
    });
    saveSettings(loadSettings());
    const now = JSON.parse(
      readFileSync(join(state, "engine-host.json"), "utf8"),
    );
    expect(now).toMatchObject({
      port: 9002,
      audioPriority: ["Scarlett"],
      webPort: 8781,
    });
  });
});
