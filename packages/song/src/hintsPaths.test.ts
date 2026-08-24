// The editor's "open the file" map: `paths` in the hints, "kind:name" → project-relative file.
// What is pinned here is the ALIAS: a project module's `extends` may be written bare
// (`instruments/drum_1`) or explicit (`@project/instruments/drum_1`) — loadModuleRefs registers
// both — and the map must answer both, or a ctrl-click and the popin's module pane go blind on
// exactly the files written the explicit way.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectHints } from "./hints";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-hints-"));
  mkdirSync(join(dir, "modules", "instruments", "drum_1"), { recursive: true });
  writeFileSync(
    join(dir, "modules", "instruments", "drum_1", "module.yaml"),
    "type: rack\nrack:\n  rack_type: samples\n  symbols: {}\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n",
    "utf8",
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the base-module path map", () => {
  it("answers the bare spelling and the @project alias with ONE file", () => {
    const { paths } = projectHints(dir);
    expect(paths["base:instruments/drum_1"]).toBe(
      "modules/instruments/drum_1/module.yaml",
    );
    expect(paths["base:@project/instruments/drum_1"]).toBe(
      "modules/instruments/drum_1/module.yaml",
    );
  });
});
