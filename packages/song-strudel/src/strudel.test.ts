// Which lanes the NODE clock plays: every strudel lane but an engine-clocked one, which the engine plays itself —
// streaming it too would double every note. That lane's file is instead one whose save re-sends the document.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enginePatternFiles, strudelPatterns } from "./strudel";

let dir: string;

function project(): string {
  const p = join(dir, "song.st0");
  mkdirSync(join(p, "nodes"), { recursive: true });
  mkdirSync(join(p, "algo"), { recursive: true });
  mkdirSync(join(p, "modules", "io", "OUT"), { recursive: true });
  writeFileSync(join(p, "project.yaml"), 'project:\n  name: "song"\n');
  writeFileSync(join(p, "modules", "io", "OUT", "module.yaml"), "io: out\n");
  writeFileSync(join(p, "algo", "a.strudel"), 's("bd")\n');
  writeFileSync(join(p, "algo", "b.strudel"), 's("sn")\n');
  writeFileSync(
    join(p, "nodes", "streamed.yaml"),
    'extends: "@meta/strudel-track"\nstrudel: algo/a.strudel\n',
  );
  writeFileSync(
    join(p, "nodes", "engined.yaml"),
    'extends: "@meta/strudel-track"\nstrudel: algo/b.strudel\nclock: engine\n',
  );
  writeFileSync(
    join(p, "graph.yaml"),
    "modules:\n  streamed: [ OUT ]\n  engined: [ OUT ]\n",
  );
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "td-strudel-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("strudel lanes and their clock", () => {
  it("leaves an engine-clocked lane out of the Node clock", () => {
    const p = project();
    const links = strudelPatterns(p);
    expect(links.map((l) => l.lanes.map((x) => x.track))).toEqual([
      ["streamed"],
    ]);
  });

  it("reports an engine-clocked lane's file as one whose save re-sends the document", () => {
    const p = project();
    expect(enginePatternFiles(p)).toEqual([join(p, "algo", "b.strudel")]);
  });
});
