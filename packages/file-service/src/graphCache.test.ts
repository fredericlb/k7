// The routing graph is memoised, and a memo is only ever as good as the thing that invalidates it.
//
// Building the graph reads the whole song (~280 ms on a real one) and the Chains tab refetches after every
// command, so the win is large — but a graph that keeps showing a chain the user just rewrote is worse than a
// slow one. It is keyed on the revision token, which moves for our own writes AND for an edit made behind the
// service's back; both directions are checked here, because only the first is easy.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModule, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Workspace } from "./workspace.ts";

let root: string;
let proj: string;
let ws: Workspace;

// gtr -> steps[0] -> … -> OUT, as segments: one node per line, destinations in flow.
const chains = (...steps: string[]) =>
  `modules:\n  gtr: [ ${steps[0] ?? "OUT"} ]\n${steps
    .map((s, i) => `  ${s}: [ ${steps[i + 1] ?? "OUT"} ]\n`)
    .join("")}`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-gcache-"));
  proj = join(root, "song.l8");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "song" } });
  writeFileSync(join(proj, "graph.yaml"), chains("amp"), "utf8");
  writeFileSync(
    join(proj, "nodes", "gtr.yaml"),
    'extends: "@studio/audio-track"\nevents: []\n',
    "utf8",
  );
  for (const m of ["amp", "cab"])
    writeModule(proj, "audio", m, {
      plugin: { type: "internal", name: "Chorus" },
    });
  ws = new Workspace(root);
  ws.setActiveProject("song.l8");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const steps = () =>
  Object.values(ws.graphDoc().chains)[0].use.map((s) => s.module);

describe("the graph memo", () => {
  it("hands back the same object while nothing has changed", () => {
    // Identity, not equality: a fresh build would be a different object, so this is what proves the memo ran.
    const a = ws.graphDoc();
    expect(ws.graphDoc()).toBe(a);
  });

  it("rebuilds after a write through the service", () => {
    expect(steps()).toEqual(["amp"]);
    ws.write("song.l8/graph.yaml", chains("amp", "cab"));
    expect(steps()).toEqual(["amp", "cab"]);
  });

  it("rebuilds after an edit made BEHIND the service's back", async () => {
    // The case a mutation counter cannot see: git pull, an external editor, another process. The token notices
    // because it carries the file count and the newest mtime.
    expect(steps()).toEqual(["amp"]);
    await new Promise((r) => setTimeout(r, 12)); // mtime resolution — the write must land in a later tick
    writeFileSync(join(proj, "graph.yaml"), chains("amp", "cab"), "utf8");
    expect(steps()).toEqual(["amp", "cab"]);
  });

  it("notices a project file appearing, not just changing", async () => {
    const before = ws.graphDoc();
    await new Promise((r) => setTimeout(r, 12));
    // A NOTE, because `graphDoc().modules` is keyed by doc modules alone now — it was every
    // module while a Docs panel aggregated their notes. The subject is unchanged: a file that
    // APPEARS must invalidate the memo, and the map is where a new one can be seen.
    writeModule(proj, "docs", "fuzz", { content: "watch the gain here" });
    expect(ws.graphDoc()).not.toBe(before);
    expect(ws.graphDoc().modules).toHaveProperty("fuzz");
  });
});
