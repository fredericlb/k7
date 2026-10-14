// Every strudel lane compiles to a lane whose halves are headed by the engine's pattern plugin, carrying the file's
// text, how the file is shared between lanes, and where samples are looked for. See engine/k7-runtime/docs/patternPlugin.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATTERN_PLUGIN_TYPE, patternFiles } from "./enginePattern";
import { compileNodeProject } from "./nodeProject";

let dir: string;
const SOURCE = 's("bd sn").label("kit")\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-pattern-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Strudel lanes over algo/beat.strudel (each `[name, extra node yaml]`), wired by `chains`. */
function project(lanes: [string, string?][], chains?: string): string {
  const p = join(dir, "song.k7");
  mkdirSync(join(p, "nodes"), { recursive: true });
  mkdirSync(join(p, "algo"), { recursive: true });
  mkdirSync(join(p, "modules", "io", "OUT"), { recursive: true });
  writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(p, "modules", "io", "OUT", "module.yaml"), "io: out\n");
  writeFileSync(join(p, "algo", "beat.strudel"), SOURCE);
  for (const [name, extra] of lanes)
    writeFileSync(
      join(p, "nodes", `${name}.yaml`),
      `extends: "@meta/strudel-track"\nstrudel: algo/beat.strudel\n${extra ?? ""}`,
    );
  writeFileSync(
    join(p, "graph.yaml"),
    chains ?? `modules:\n${lanes.map(([n]) => `  ${n}: [ OUT ]\n`).join("")}`,
  );
  return p;
}

const patternsOf = (p: string) =>
  compileNodeProject(p)
    .tracks.flatMap((t) => t.plugins.map((pl) => ({ track: t, pl })))
    .filter(({ pl }) => pl.type === PATTERN_PLUGIN_TYPE);

describe("a pattern lane", () => {
  it("is headed by ONE plugin playing both when it is bare-wired", () => {
    const p = project([["kit"]]);
    const [only, ...rest] = patternsOf(p);
    expect(rest).toEqual([]);
    expect(only.track.plugins[0]).toBe(only.pl);
    expect(only.pl).toMatchObject({
      id: "kit:pattern",
      patternSource: SOURCE,
      patternLabel: "kit",
      patternPlays: "both",
      patternOnly: true,
      patternCatchAll: true,
      patternClaimed: ["kit"],
    });
    expect(only.pl.patternBanks?.[0]).toBe(join(p, "samples"));
  });

  it("plays its notes on #midi and its samples on #audio when the two are wired apart", () => {
    const p = project(
      [["kit"]],
      "modules:\n  kit#audio: [ OUT ]\n  kit#midi: [ OUT ]\n",
    );
    const got = patternsOf(p).map(({ track, pl }) => [
      track.contentType,
      pl.patternPlays,
      pl.patternOnly,
    ]);
    expect(got.sort()).toEqual([
      ["audio", "samples", false],
      ["notes", "notes", false],
    ]);
    // Two plugins, two ids: the engine keys its plugins by id.
    expect(new Set(patternsOf(p).map(({ pl }) => pl.id)).size).toBe(2);
  });

  it("with one half wired, plays only that and knows nothing else will", () => {
    const p = project([["kit"]], "modules:\n  kit#audio: [ OUT ]\n");
    expect(
      patternsOf(p).map(({ pl }) => [pl.patternPlays, pl.patternOnly]),
    ).toEqual([["samples", true]]);
  });

  it("shares its file: the first lane by name takes what no lane claims", () => {
    const p = project([["pad"], ["kit"]]);
    const byLane = Object.fromEntries(
      patternsOf(p).map(({ pl }) => [pl.patternLabel, pl]),
    );
    expect(byLane.kit.patternCatchAll).toBe(true);
    expect(byLane.pad.patternCatchAll).toBe(false);
    expect(byLane.pad.patternClaimed).toEqual(["kit", "pad"]);
  });

  it("names its file among the ones whose save is a recompile", () => {
    const p = project([["kit"]]);
    expect(patternFiles(p)).toEqual([join(p, "algo", "beat.strudel")]);
  });
});
