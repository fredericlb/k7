// `node stack` — the bottom `+`'s verb. The file work is @studio/song's chainStack.ts, tested there;
// this holds what the VERB adds: the names `node new` gave, and the refusal outside a chain project.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

let root: string;
let dir: string;
const put = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "node-stack-"));
  dir = join(root, "song.k7");
  put("project.yaml", "project:\n  name: t\n  tempo: 120\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = async (line: string) => {
  const h = testHost({ songPath: dir });
  await runCommand(line, h, "cli");
  return h;
};

describe("node stack", () => {
  it("stacks a node by the name `node new` gave it", async () => {
    put("tracks/gtr.yaml", 'extends: "@meta/track"\nevents: []\n');
    put(
      "chains/gtr.yaml",
      'start: true\nsteps:\n  - { id: lane-gtr, track: gtr }\n  - { id: amp-1, extends: "@k7-core/audio/amp" }\n  - to: [ { chain: MIX } ]\n',
    );
    // `node new` names the CHAIN; the node inside is an id.
    put(
      "chains/eq.yaml",
      'steps:\n  - { id: eq-1, extends: "@k7-core/audio/eq" }\n',
    );
    const h = await run("node stack amp-1 eq");
    expect(h.lines.refuse).toEqual([]);
    const gtr = parse(readFileSync(join(dir, "chains/gtr.yaml"), "utf8"));
    expect(gtr.steps[1]).toEqual({ sub: "amp" });
  });

  it("refuses a project kept as graph.yaml, which has no subchains", async () => {
    put("graph.yaml", "modules: {}\n");
    const h = await run("node stack a b");
    expect(h.lines.refuse.join(" ")).toMatch(/only a chain project/);
  });
});
