// A strudel lane with `clock: engine` compiles to a lane whose NOTES half starts with the pattern plugin, carrying the
// file's text — and a lane without it compiles exactly as before. See engine/st0-engine/docs/patternPlugin.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATTERN_PLUGIN_TYPE } from "./enginePattern";
import { compileNodeProject } from "./nodeProject";

let dir: string;
const SOURCE = 's("bd sn").label("kit")\n';

/** One strudel lane `kit` over algo/beat.strudel, with `extra` on its node and `chains` as graph.yaml. */
function project(extra: string, chains = "modules:\n  kit: [ OUT ]\n"): string {
  const p = join(dir, "song.st0");
  mkdirSync(join(p, "nodes"), { recursive: true });
  mkdirSync(join(p, "algo"), { recursive: true });
  mkdirSync(join(p, "modules", "io", "OUT"), { recursive: true });
  writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(p, "modules", "io", "OUT", "module.yaml"), "io: out\n");
  writeFileSync(join(p, "algo", "beat.strudel"), SOURCE);
  writeFileSync(
    join(p, "nodes", "kit.yaml"),
    `extends: "@meta/strudel-track"\nstrudel: algo/beat.strudel\n${extra}`,
  );
  writeFileSync(join(p, "graph.yaml"), chains);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-pattern-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("an engine-clocked pattern lane", () => {
  it("starts its notes half with the pattern plugin, source and label inline", () => {
    const doc = compileNodeProject(project("clock: engine\n"));
    const kit = doc.tracks.find((t) => t.id === "kit");
    const head = kit?.plugins[0];
    expect(head?.type).toBe(PATTERN_PLUGIN_TYPE);
    expect(head?.id).toBe("kit:pattern");
    expect(head?.patternSource).toBe(SOURCE);
    expect(head?.patternLabel).toBe("kit");
  });

  it("is left alone without `clock: engine` — the Node clock plays it, as before", () => {
    const doc = compileNodeProject(project(""));
    const kit = doc.tracks.find((t) => t.id === "kit");
    expect(kit?.plugins.some((p) => p.type === PATTERN_PLUGIN_TYPE)).toBe(
      false,
    );
  });

  it("lands on the midi half when the two outputs are wired apart", () => {
    const doc = compileNodeProject(
      project(
        "clock: engine\n",
        "modules:\n  kit#audio: [ OUT ]\n  kit#midi: [ OUT ]\n",
      ),
    );
    const withPattern = doc.tracks.filter((t) =>
      t.plugins.some((p) => p.type === PATTERN_PLUGIN_TYPE),
    );
    expect(withPattern.map((t) => t.contentType)).toEqual(["notes"]);
  });

  it("names the missing output rather than playing nothing", () => {
    expect(() =>
      compileNodeProject(
        project("clock: engine\n", "modules:\n  kit#audio: [ OUT ]\n"),
      ),
    ).toThrow(/clock: engine plays notes.*kit#midi/);
  });
});
