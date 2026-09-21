// An ADSR curve, end to end: from a folder on disk to the breakpoints the engine receives.
// What this pins is the WIRING — that the envelope is placed at the notes of the lane that
// plays it — which the shape tests in adsrCurve.test.ts deliberately say nothing about.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProject } from "./project";

let dir: string;
const put = (rel: string, body: string): void => {
  const p = join(dir, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, body, "utf8");
};

/** A synth lane playing two notes, its filter swept by an envelope those notes fire. */
function song(automation: string, curve: string): void {
  dir = mkdtempSync(join(tmpdir(), "td-adsr-"));
  put(
    "project.yaml",
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
  );
  put("graph.yaml", "modules:\n  synth: [ osc ]\n  osc: [ OUT ]\n");
  put(
    "nodes/synth.yaml",
    'extends: "@meta/track"\nevents:\n  - { ref: riff, start: "1:1" }\n',
  );
  put(
    "sequences/riff.yaml",
    // Two notes, one at the clip's start and one a beat later.
    "notes:\n  - { k: 60, t: 0, d: 0.5 }\n  - { k: 64, t: 1, d: 0.5 }\n",
  );
  put("nodes/osc.yaml", `plugin:\n  type: internal\n  name: 4OSC\n${automation}`);
  put("curves/env1.yaml", curve);
}

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ENV = `type: adsr
attack: 0
decay: 0
sustain: 250
release: 250
level: 1
`;

describe("an envelope reaches the engine placed at the notes", () => {
  it("fires once per note-on of the lane that plays it", () => {
    song("automations:\n  - { param: Filter Freq, curve: env1 }\n", ENV);
    const lane = loadProject(dir).tracks.find((t) => t.id === "synth")!;
    const a = lane.automation.find((x) => x.param === "Filter Freq");
    expect(a).toBeDefined();
    // The microbeat pairs are the INSTANT stages: a zero attack is a step, and a step needs two points.
    expect(a!.points).toEqual([
      [0, 0],
      [0.000001, 1], // straight up: attack 0
      [0.5, 1], // …held
      [1, 0], // …and back down over the release
      [1.000001, 1], // the second note, up again
      [1.5, 1],
      [2, 0],
    ]);
    expect(a!.pluginId).toBe("synth:osc");
  });

  it("leaves the parameter alone when nothing plays it", () => {
    // No notes, no triggers, no points — rather than a lane pinning the param at zero.
    song("automations:\n  - { param: Filter Freq, curve: env1 }\n", ENV);
    put("sequences/riff.yaml", "notes: []\n");
    const lane = loadProject(dir).tracks.find((t) => t.id === "synth")!;
    expect(lane.automation).toHaveLength(0);
  });

  it("still bakes a curve of song TIME over the whole song, notes or not", () => {
    // An LFO is triggered by nothing, so removing the notes must not silence it.
    song(
      "automations:\n  - { param: Filter Freq, curve: env1 }\n",
      "type: lfo\nfrequency: 1\n",
    );
    put("sequences/riff.yaml", "notes: []\n");
    const lane = loadProject(dir).tracks.find((t) => t.id === "synth")!;
    expect(lane.automation[0].points.length).toBeGreaterThan(20);
  });
});
