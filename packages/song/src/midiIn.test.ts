// A MIDI device as a node: wired to a lane it says what that lane RECORDS, which the browser does.
// What is pinned is that the cable is legal, that the engine is handed nothing for it, and that the
// device travels by its label. See docs/midiIn.md.

import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { createNode } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { setDoc, writeNode } from "./testSupport";
import { wsData } from "./yaml/workspaceDoc";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

describe("a MIDI device wired to a lane", () => {
  let ws: string;
  let dir: string;
  const wire = (modules: Record<string, string[]>): void => {
    for (const [from, to] of Object.entries(modules))
      setDoc(join(dir, GRAPH_FILE), ["modules", from], to);
  };
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-midiin-"));
    dir = join(ws, "song");
    cpSync(join(DEMOS, "synth-demo.k7"), dir, { recursive: true });
    cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), { recursive: true });
    writeNode(dir, "keys", { extends: "@meta/MIDI", device: "KeyStep 37" });
    wire({ keys: ["melody"] });
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("is a legal cable: no warning about what lands on a lane", () => {
    expect(loadGraph(dir).warnings.filter((w) => w.includes("keys"))).toEqual(
      [],
    );
  });

  it("carries its device by label, and is a MIDI source", () => {
    const keys = loadGraph(dir).modules.keys;
    expect(keys?.io).toBe("midi");
    expect(keys?.device).toBe("KeyStep 37");
  });

  it("hands the engine nothing: no input, no plugin, no track of its own", () => {
    const doc = compileNodeProject(dir);
    const melody = doc.tracks.find((t) => t.id === "melody");
    expect(melody?.inputChannels).toEqual([]);
    expect(melody?.plugins.some((p) => p.id.includes("keys"))).toBe(false);
    expect(doc.tracks.some((t) => t.id.includes("keys"))).toBe(false);
  });

  it("is refused as a destination: notes come FROM a keyboard", () => {
    wire({ keys: [], lead: ["keys"] });
    expect(
      loadGraph(dir).warnings.some((w) => w.includes("is a MIDI device")),
    ).toBe(true);
  });

  it("is made by `node new io/MIDI`, its file naming the role and no device", () => {
    const rel = createNode(dir, "io", "MIDI", "pads");
    const data = wsData(join(dir, rel));
    expect(data.io).toBe("midi");
    expect(data).not.toHaveProperty("device");
  });
});
