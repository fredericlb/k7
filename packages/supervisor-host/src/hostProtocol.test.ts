// hostProtocol.test.ts — the schema against the frames: the C++ writer's own fixtures, and what a host makes of them.
// The fixtures are what HostProtocol_test.cpp compares stateFrame() with, so a field either side adds breaks one suite.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { StateFrame } from "./hostProtocol.generated.ts";
import { parseFrame, snapshotOf } from "./hostProtocol.ts";

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../schema");
const read = (p: string) =>
  JSON.parse(readFileSync(join(SCHEMA_DIR, p), "utf8"));
const schema = read("hostProtocol.schema.json");
const line = z.fromJSONSchema(schema);
const fixture = (name: string) => read(`fixtures/${name}.json`);

describe("the host protocol schema", () => {
  it("accepts every frame the supervisor's tests pin", () => {
    for (const name of ["state-full", "state-empty", "result"])
      expect(line.safeParse(fixture(name)).success, name).toBe(true);
  });

  it("accepts the frames no C++ test pins: notify, engine, a command", () => {
    const frames = [
      { t: "notify", kind: "modal", title: "Engine", body: "stopped" },
      {
        t: "engine",
        action: "start",
        id: "e1",
        token: "k",
        port: 8765,
        host: "0.0.0.0",
        origins: "",
        safeMode: 0,
      },
      { t: "engine", action: "stop" },
      JSON.parse('{"t":"cmd","id":4,"cmd":"audio.priority","arg":"A\\u001fB"}'),
    ];
    for (const f of frames) expect(line.safeParse(f).success, f.t).toBe(true);
  });

  it("names every field the full fixture carries", () => {
    const declared = Object.keys(schema.definitions.StateFrame.properties);
    expect(Object.keys(fixture("state-full")).sort()).toEqual(declared.sort());
  });

  it("refuses a field it does not declare, a wrong type and a missing key", () => {
    const full = fixture("state-full");
    expect(line.safeParse({ ...full, extra: 1 }).success).toBe(false);
    expect(line.safeParse({ ...full, enginePort: "8765" }).success).toBe(false);
    const { engineId: _gone, ...missing } = full;
    expect(line.safeParse(missing).success).toBe(false);
    const row = { ...full.sessions[0], volume: 1 };
    expect(line.safeParse({ ...full, sessions: [row] }).success).toBe(false);
  });

  it("lets a state frame leave an empty list out", () => {
    const { instruments: _i, plugins: _p, ...lean } = fixture("state-empty");
    expect(line.safeParse(lean).success).toBe(true);
  });
});

describe("snapshotOf", () => {
  it("fills the lists a frame left out and drops the nulls that mean none", () => {
    const s = snapshotOf(
      parseFrame(JSON.stringify(fixture("state-empty"))) as StateFrame,
    );
    expect(s.downloads).toEqual([]);
    expect("pluginCount" in s).toBe(false);
    expect("instanceCheck" in s).toBe(false);
    expect("t" in s || "owns" in s).toBe(false);
  });

  it("keeps every value a full frame carries", () => {
    const f = fixture("state-full");
    const s = snapshotOf(f);
    expect(s.pluginCount).toBe(1);
    expect(s.instanceCheck?.state).toBe("refused");
    expect(s.downloads[0]?.phase).toBe("failed");
    expect(s.paths).toEqual(f.paths);
  });
});
