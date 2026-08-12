import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraph } from "./graph";
import { compileNodeProject } from "./nodeProject";
import { formatChains, parseChains } from "./yaml/chainsFile";

// An io "in" module used to name the track it fed, with a `track:` field. That could not
// survive the module living in a workspace's shared _modules: `module populate` files one
// io/IN instance per physical input there, and which TRACK an input lands on is a
// per-project answer — the shared file had nowhere to put it.
//
// So the wiring moved to the chain: an input is a step, and the chain it sits in already
// names the track. These pin the new relation from both ends — what the engine gets, and
// what the graph says when the chain can't answer the question.

const here = dirname(fileURLToPath(import.meta.url)); // packages/song/src
const SONG = join(
  here,
  "..",
  "..",
  "..",
  "engine",
  "capot",
  "songs",
  "synth-demo.l8",
);
const IN = "@workspace/io/IN:in-1";

describe("a live input, wired by its chain", () => {
  let ws: string;
  let dir: string;
  // Wire nodes into chains.yaml's segments — each call merges, so a test states only its
  // own edges. The shipping writer emits, so the fixture cannot drift from the format.
  const wire = (seg: { modules?: Record<string, string[]> }): void => {
    const p = join(dir, "chains.yaml");
    const cur = parseChains(readFileSync(p, "utf8")).value ?? {};
    writeFileSync(
      p,
      formatChains({
        modules: { ...cur.modules, ...seg.modules },
        bypassed: cur.bypassed,
      }),
      "utf8",
    );
  };
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-livein-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    // The shared catalogue as `module populate` leaves it: a generic IN, and one
    // instance per interface input carrying nothing but its channel.
    mkdirSync(join(ws, "_modules", "io", "IN"), { recursive: true });
    writeFileSync(join(ws, "_modules", "io", "IN", "module.yaml"), "io: in\n");
    writeFileSync(
      join(ws, "_modules", "io", "IN", "in-1.yaml"),
      "channel: [1]\n",
    );
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
    // An interface input carries audio, and every lane the fixture ships plays
    // sequences — so the input gets an audio lane of its own. Called `mic` rather than
    // `live`: the fixture already has a group by that name, and one flat name space
    // means one name, one node.
    writeFileSync(
      join(dir, "instances", "mic.yaml"),
      'extends: "@studio/audio-track"\n',
    );
    wire({ modules: { mic: [IN], [IN]: ["OUT"] } });
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

  it("says so when its run reaches no track", () => {
    // Nothing feeds the input and it feeds nothing but OUT, so no lane owns it — there is
    // no track for the signal to land on. The case the old `track:` field could not express.
    wire({ modules: { mic: [] } });
    const w = loadGraph(dir).warnings;
    expect(
      w.some((x) => x.includes("an input's signal has to land on one")),
    ).toBe(true);
  });

  // The direction that reads correctly, and the one the graph draws: signal comes FROM an
  // input, INTO a lane. The old chain-list format could not say it — a chain named its
  // track up front and the input was a node inside it, so the arrow pointed backwards.
  describe("an input that FEEDS a track", () => {
    beforeEach(() => wire({ modules: { mic: [], [IN]: ["mic"] } }));

    it("lands on the track its run ends at", () => {
      expect(loadGraph(dir).warnings.filter((w) => w.includes("in-1"))).toEqual(
        [],
      );
      const live = compileNodeProject(dir).tracks.find((t) => t.id === "mic");
      // The whole point: without this the lane compiles with no input, and arming it says
      // "has no input — nothing to record" about a rig that is plainly wired.
      expect(live?.inputChannels).toEqual([1]);
    });

    it("does not read the track as a dangling destination", () => {
      // A track is not a chain and not a sink, so the ordinary out-check would call it
      // neither. It is the one destination that is a LANE.
      expect(
        loadGraph(dir).warnings.filter((w) =>
          w.includes("not a chain or io sink"),
        ),
      ).toEqual([]);
    });

    it("refuses the same arrow from a module that is not an input", () => {
      // A track's material is its clips, so an ordinary module aimed at one is silently
      // discarded — which is exactly what a warning is for.
      wire({ modules: { [IN]: ["OUT"], lead: ["mic"] } });
      expect(
        loadGraph(dir).warnings.some((x) =>
          x.includes("only a live input's signal lands on a lane"),
        ),
      ).toBe(true);
    });
  });

  it("still refuses a track that carries no audio", () => {
    // The input goes AHEAD of the synth on the melody run, so the only thing wrong with
    // the wiring is the one this is about: melody carries sequences, not audio.
    wire({ modules: { mic: [], melody: [IN], [IN]: ["lead"] } });
    expect(
      loadGraph(dir).warnings.some((x) =>
        x.includes("is a sequences track — an interface input carries audio"),
      ),
    ).toBe(true);
  });

  // An input at the END of a run is read as somewhere to route TO — which is exactly what
  // it isn't. Worth its own case: it is the shape you reach for first, and the diagnosis
  // has to point at the sink rather than stay silent.
  it("is not mistaken for a sink when it ends the run", () => {
    wire({ modules: { [IN]: [] } }); // `mic` still feeds it, and it feeds nothing
    expect(
      loadGraph(dir).warnings.some(
        (x) => x.includes(IN) && x.includes("signal comes FROM it"),
      ),
    ).toBe(true);
  });
});

// The two things an input carries besides WHICH channel it is: whether you hear it, and how much trim it gets.
// Both are properties of the interface device engine-side, so they ride the track the input landed on — there
// is nowhere else for them to go, and a value that never reaches the engine is a field that does nothing.
describe("an input's monitoring and gain", () => {
  let ws: string;
  let dir: string;
  const instance = (body: string) => {
    writeFileSync(join(ws, "_modules", "io", "IN", "in-1.yaml"), body);
    return compileNodeProject(dir).tracks.find((t) => t.id === "mic");
  };

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), "td-ingain-"));
    dir = join(ws, "song");
    cpSync(SONG, dir, { recursive: true });
    mkdirSync(join(ws, "_modules", "io", "IN"), { recursive: true });
    writeFileSync(join(ws, "_modules", "io", "IN", "module.yaml"), "io: in\n");
    writeFileSync(
      join(ws, "_modules", "io", "IN", "in-1.yaml"),
      "channel: [1]\n",
    );
    const p = join(dir, "project.yaml");
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "modules_from: []",
        "modules_from: [ ../_modules ]",
      ),
    );
    writeFileSync(
      join(dir, "instances", "mic.yaml"),
      'extends: "@studio/audio-track"\n',
    );
    const c = join(dir, "chains.yaml");
    const cur = parseChains(readFileSync(c, "utf8")).value ?? {};
    writeFileSync(
      c,
      formatChains({
        modules: { ...cur.modules, mic: [IN], [IN]: ["OUT"] },
        bypassed: cur.bypassed,
      }),
      "utf8",
    );
  });
  afterEach(() => rmSync(ws, { recursive: true, force: true }));

  it("defaults to auto and unity — an input that says neither changes neither", () => {
    const live = instance("channel: [1]\n");
    expect(live?.monitor).toBe("auto");
    expect(live?.inputGain).toBe(0);
  });

  it("takes the boolean spelling, which is the everyday one", () => {
    expect(instance("channel: [1]\nmonitor: true\n")?.monitor).toBe("on");
    expect(instance("channel: [1]\nmonitor: false\n")?.monitor).toBe("off");
  });

  it("still takes the tri-state — only it can say 'auto'", () => {
    // "auto" is audible once ARMED, which is neither on nor off: dropping the enum for a
    // boolean would have removed the default rather than added a spelling.
    expect(instance("channel: [1]\nmonitor: auto\n")?.monitor).toBe("auto");
    expect(instance("channel: [1]\nmonitor: on\n")?.monitor).toBe("on");
  });

  it("carries the gain in dB, negative included", () => {
    expect(instance("channel: [1]\ngain: 6\n")?.inputGain).toBe(6);
    expect(instance("channel: [1]\ngain: -3.5\n")?.inputGain).toBe(-3.5);
  });

  it("leaves a track with no input at unity, not at some other track's trim", () => {
    instance("channel: [1]\ngain: 12\n");
    const melody = compileNodeProject(dir).tracks.find(
      (t) => t.id === "melody",
    );
    expect(melody?.inputChannels).toEqual([]);
    expect(melody?.inputGain).toBe(0);
  });
});
