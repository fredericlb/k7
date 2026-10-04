// A dropdown on a card writes an INTRINSIC — `node param <node> @<field> <value>` — and shows what
// the file says, with no optimistic value of its own. So the graph the command HANDS BACK is the
// only thing that moves the control: if it carries the old field, the select snaps back and the
// feature reads as broken while every part of it works. See packages/ui-chains/docs/graphBuild.md.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWebCommand } from "./engineLink.ts";
import { Workspace } from "./workspace.ts";

let root: string;
let proj: string;
let ws: Workspace;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-intrinsic-"));
  proj = join(root, "rig.st0");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeYaml(join(proj, "project.yaml"), { project: { name: "rig" } });
  writeFileSync(
    join(proj, "graph.yaml"),
    "modules:\n  IN: [ amp ]\n  amp: [ MIX ]\n  MIX: [ OUT ]\n",
    "utf8",
  );
  // io is a plain node now, made directly — OUT needs no file, it's a built-in sink name.
  writeFileSync(
    join(proj, "nodes", "IN.yaml"),
    'io: in\nmonitor: "off"\nchannel: [1]\n',
    "utf8",
  );
  writeFileSync(
    join(proj, "nodes", "amp.yaml"),
    "plugin:\n  type: internal\n  name: Chorus\n",
    "utf8",
  );
  ws = new Workspace(root);
  ws.setActiveProject("rig.st0");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The live input as the card reads it, out of whichever graph is handed in. */
const input = (g = ws.graphDoc()) => {
  for (const c of Object.values(g.chains))
    for (const s of c.use) if (s.monitor !== undefined) return s;
  return undefined;
};

/** Run a verb the way the /command route does, and hand back the graph it built. */
const run = async (line: string) => {
  const { before, after, graph } = await runWebCommand(
    ws,
    line,
    undefined,
    undefined,
    { graph: true },
  );
  return { moved: before !== after, graph };
};

describe("an intrinsic a dropdown wrote", () => {
  it("is on the card before anything happens", () => {
    expect(input()?.monitor).toBe("off");
    expect(input()?.channel).toEqual([1]);
  });

  it("reaches the graph the COMMAND hands back — what the select redraws from", async () => {
    const { moved, graph } = await run("node param IN @monitor on");
    // Any write moves the token, so the route sends a graph rather than leaving the card to refetch.
    expect(moved).toBe(true);
    expect(input(graph)?.monitor).toBe("on");
  });

  it("reaches a REFETCHED graph too, for the callers that ask again", async () => {
    await run("node param IN @monitor on");
    expect(input()?.monitor).toBe("on");
  });

  it("does the same for the socket, which is the other dropdown on that card", async () => {
    const { graph } = await run("node param IN @channel 2");
    expect(input(graph)?.channel).toEqual([2]);
  });
});
