// The shipped `turntable` template, held to the set the scaffold writes. There are two documents
// saying what a turntable is — `k7-core/assemblies/turntable/` for a project that has no decks
// yet, and `scaffoldSet` for one being created — and the thing that actually breaks when they drift
// is the NAMES: a member the map does not mention is a knob that silently drives nothing.
// See docs/assemblies.md.

import { join } from "node:path";
import { turntableMembers } from "@studio/song-schema/stems";
import { parseAssemblyTemplate } from "@studio/song-schema/yaml/assemblyFile";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { describe, expect, it } from "vitest";
import { entityFiles } from "./yaml/moduleIO";
import { wsRead } from "./yaml/workspaceFile";

const FOLDER = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "k7-core",
  "assemblies",
  "turntable",
);

const template = parseAssemblyTemplate(wsRead(join(FOLDER, "assembly.k7x")));
const members = entityFiles(join(FOLDER, "nodes"), "nodes").map((f) => f.id);

describe("the shipped turntable template", () => {
  it("reads", () => {
    expect(template.issues).toEqual([]);
    expect(template.value?.label).toBe("Turntable");
  });

  it("holds exactly the members a scaffolded deck maps", () => {
    expect(members.slice().sort()).toEqual(
      Object.keys(turntableMembers("deckA")).sort(),
    );
  });

  it("names only members in its plugs and its promoted params", () => {
    const named = [
      ...(template.value?.inputs ?? []),
      ...(template.value?.outputs ?? []),
    ].map((p) => p.node);
    for (const n of named) expect(members).toContain(n);
    for (const t of Object.values(template.value?.params ?? {}))
      expect(members).toContain(t.node);
  });

  it("wires only members, and the two built-in sinks a deck ends at", () => {
    const g = parseGraph(wsRead(join(FOLDER, "graph.k7x")));
    expect(g.issues).toEqual([]);
    const known = new Set([...members, "MIX", "CUE"]);
    for (const [key, dests] of Object.entries(g.value?.modules ?? {})) {
      expect(known).toContain(key);
      for (const d of dests) expect(known).toContain(d);
    }
    // Every member is in the graph: a node the wiring never names is one nothing can reach.
    for (const m of members)
      expect(Object.keys(g.value?.modules ?? {})).toContain(m);
  });
});
