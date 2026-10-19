import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { setDoc, writeDoc, writeNode } from "./testSupport";

// An input's track is named by the CHAIN, not by a field: a shared io/IN node cannot name one.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const DEMOS = join(here, "..", "..", "..", "demos");
const SONG = join(DEMOS, "synth-demo.k7");
const IN = "@workspace/io/IN:in-1";

/** Set each module's destinations in `dir`'s graph, by key path, leaving the other modules as they are. */
const wireIn = (dir: string, modules: Record<string, string[]>): void => {
  for (const [from, to] of Object.entries(modules))
    setDoc(join(dir, GRAPH_FILE), ["modules", from], to);
};

/** The demo song in `ws/song`, its workspace's `_modules` with a generic IN and one input, and a lane `mic`. */
function liveSong(ws: string): string {
  const dir = join(ws, "song");
  cpSync(SONG, dir, { recursive: true });
  // The Examples workspace's own shared library, beside every demo project.
  cpSync(join(DEMOS, "_modules"), join(ws, "_modules"), { recursive: true });
  // The shared catalogue as `module populate` leaves it: a generic IN and one node per input.
  writeDoc(join(ws, "_modules", "io", "IN", "module.k7x"), { io: "in" });
  writeDoc(join(ws, "_modules", "io", "IN", "in-1.k7x"), { channel: [1] });
  // An audio lane of its own, called `mic`: the fixture already has a group called `live`.
  writeNode(dir, "mic", { extends: "@meta/track" });
  wireIn(dir, { mic: [IN], [IN]: ["OUT"] });
  return dir;
}

describe("a live input, wired by its chain", () => {
  let ws: string;
  let dir: string;
  const wire = (seg: { modules: Record<string, string[]> }): void =>
    wireIn(dir, seg.modules);
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-livein-"));
    dir = liveSong(ws);
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("lands on the track of the chain it sits in", () => {
    const g = loadGraph(dir);
    expect(g.warnings.filter((w) => w.includes("in-1"))).toEqual([]);
    const live = compileNodeProject(dir).tracks.find((t) => t.id === "mic");
    expect(live?.inputChannels).toEqual([1]);
    // …and it is not a plugin: an io module contributes no processor to the track.
    expect(live?.plugins.some((pl) => pl.id.includes("in-1"))).toBe(false);
  });

  it("feeds no other track", () => {
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.inputChannels).toEqual([]);
  });

  it("MAKES its own track when its run reaches no lane", () => {
    // The lane stops feeding it, leaving `IN: [OUT]` — a rig with nothing arranged. That used to
    // warn and compile to nothing; it now materialises a track of its own, the way a bus does,
    // because the engine assigns an input to a track and there is no lane to be. docs/liveProject.md.
    wire({ modules: { mic: [] } });
    expect(
      loadGraph(dir).warnings.some((x) => x.includes("has to land on one")),
    ).toBe(false);
    // Named after the CHAIN, which is this file's whole subject — here the input node's own ref.
    const own = compileNodeProject(dir).tracks.find((t) => t.id === IN);
    expect(own?.inputChannels).toEqual([1]);
    expect(own?.role).toBe("regular");
    // Nothing to play: what is heard is what is plugged in.
    expect(own?.clips).toEqual([]);
  });

  // Signal comes FROM an input INTO a lane, and the file draws that direction.
  describe("an input that FEEDS a track", () => {
    beforeEach(() => wire({ modules: { mic: [], [IN]: ["mic"] } }));

    it("lands on the track its run ends at", () => {
      expect(loadGraph(dir).warnings.filter((w) => w.includes("in-1"))).toEqual(
        [],
      );
      const live = compileNodeProject(dir).tracks.find((t) => t.id === "mic");
      // Without this the lane compiles with no input and refuses to arm on a wired rig.
      expect(live?.inputChannels).toEqual([1]);
    });

    it("does not read the track as a dangling destination", () => {
      // A track is neither a chain nor a sink: it is the one destination that is a LANE.
      expect(
        loadGraph(dir).warnings.filter((w) =>
          w.includes("not a chain or io sink"),
        ),
      ).toEqual([]);
    });

    it("refuses the same arrow from a module that is not an input", () => {
      // A track's material is its clips, so an ordinary module aimed at one is discarded.
      wire({ modules: { [IN]: ["OUT"], lead: ["mic"] } });
      expect(
        loadGraph(dir).warnings.some((x) =>
          x.includes(
            "only a live input's or a MIDI device's signal lands on a lane",
          ),
        ),
      ).toBe(true);
    });
  });

  it("lands on the AUDIO half of a split lane", () => {
    // On the midi half it would arm a track whose chain is an instrument, recording through it.
    writeNode(dir, "mic", {
      extends: "@meta/track",
      events: [{ ref: "melody", start: "1:1:1" }],
    });
    wire({
      modules: { "mic#audio": ["OUT"], "mic#midi": ["lead"], mic: [IN] },
    });
    const tracks = compileNodeProject(dir).tracks;
    expect(tracks.find((t) => t.id === "mic#audio")?.inputChannels).toEqual([
      1,
    ]);
    expect(tracks.find((t) => t.id === "mic#midi")?.inputChannels).toEqual([]);
  });

  it("no longer refuses a lane holding sequences — every lane has an audio output", () => {
    // A detyped lane offers both outputs whatever it holds, so overdubbing needs no second lane.
    wire({ modules: { mic: [], melody: [IN], [IN]: ["lead"] } });
    expect(
      loadGraph(dir).warnings.some((x) =>
        x.includes("an interface input carries audio"),
      ),
    ).toBe(false);
  });

  // An input at the END of a run reads as somewhere to route TO, which is what it is not.
  it("is not mistaken for a sink when it ends the run", () => {
    wire({ modules: { [IN]: [] } }); // `mic` still feeds it, and it feeds nothing
    expect(
      loadGraph(dir).warnings.some(
        (x) => x.includes(IN) && x.includes("signal comes FROM it"),
      ),
    ).toBe(true);
  });
});

// Monitoring and trim are device properties engine-side, so they ride the track the input landed on.
describe("an input's monitoring and gain", () => {
  let ws: string;
  let dir: string;
  const node = (body: Record<string, unknown>) => {
    writeDoc(join(ws, "_modules", "io", "IN", "in-1.k7x"), {
      channel: [1],
      ...body,
    });
    return compileNodeProject(dir).tracks.find((t) => t.id === "mic");
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-ingain-"));
    dir = liveSong(ws);
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("defaults to auto and unity — an input that says neither changes neither", () => {
    const live = node({});
    expect(live?.monitor).toBe("auto");
    expect(live?.inputGain).toBe(0);
  });

  it("takes the boolean spelling, which is the everyday one", () => {
    expect(node({ monitor: true })?.monitor).toBe("on");
    expect(node({ monitor: false })?.monitor).toBe("off");
  });

  it("reads a boolean the same way in the graph the UI draws", () => {
    const graphMonitor = (body: Record<string, unknown>) => {
      node(body);
      return loadGraph(dir).moduleRefs[IN]?.monitor;
    };
    expect(graphMonitor({ monitor: true })).toBe("on");
    expect(graphMonitor({ monitor: false })).toBe("off");
    expect(graphMonitor({})).toBeUndefined();
  });

  it("still takes the tri-state — only it can say 'auto'", () => {
    // "auto" is audible once ARMED, so a boolean-only spelling would drop the default.
    expect(node({ monitor: "auto" })?.monitor).toBe("auto");
    expect(node({ monitor: "on" })?.monitor).toBe("on");
  });

  it("carries the gain in dB, negative included", () => {
    expect(node({ gain: 6 })?.inputGain).toBe(6);
    expect(node({ gain: -3.5 })?.inputGain).toBe(-3.5);
  });

  it("leaves a track with no input at unity, not at some other track's trim", () => {
    node({ gain: 12 });
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.inputChannels).toEqual([]);
    expect(melody?.inputGain).toBe(0);
  });
});
