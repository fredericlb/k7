// A chain project's files classified by path: a chain file is checked as one and offers a chain's
// fields, a lane file is a module file, and the older names keep their old kinds.

import { describe, expect, it } from "vitest";
import { fieldsAt, fileKindFor, valuesAt } from "./fields";
import { validateFile } from "./validate";

const CHAIN = `start(true)
steps([
  { id: "l1", track: "gtr" },
  { id: "a1", extends: "@k7-core/audio/chorus" },
  { to: [{ chain: "MIX" }] },
])
`;

describe("validateFile", () => {
  it("checks chains/<name>.k7x as a chain file", () => {
    expect(validateFile("song/chains/gtr.k7x", CHAIN)).toMatchObject({
      ok: true,
      depth: "schema",
    });
    const bad = validateFile(
      "chains/gtr.k7x",
      'steps([{ id: "l1", track: "gtr" }])\n',
    );
    expect(bad.ok).toBe(false);
  });

  it("checks tracks/<lane>.k7x as a module file", () => {
    const v = validateFile("tracks/gtr.k7x", "extends(3)\n");
    expect(v.depth).toBe("schema");
    expect(v.ok).toBe(false);
  });

  it("keeps a library chain folder's graph.k7x and nodes/ as they were read", () => {
    expect(
      validateFile("_libraries/k7-core/chains/verb/graph.k7x", "modules({})\n")
        .ok,
    ).toBe(true);
    expect(
      validateFile("_libraries/k7-core/chains/verb/nodes/v.k7x", "extends(3)\n")
        .ok,
    ).toBe(false);
  });

  it("judges no file that is not a workspace document", () => {
    expect(validateFile("song/chains/gtr.yaml", "steps: [\n")).toMatchObject({
      ok: true,
      depth: "none",
    });
  });
});

describe("fileKindFor", () => {
  it("names a chain file, a lane file and the older segments files", () => {
    expect(fileKindFor("chains/gtr.k7x")).toBe("chain");
    expect(fileKindFor("tracks/gtr.k7x")).toBe("module");
    // A picture lane is a lane node, its fields the module's.
    expect(fileKindFor("nodes/cam.k7x")).toBe("module");
    expect(fileKindFor("chains.k7x")).toBe("chains");
    expect(fileKindFor("chains/verb/graph.k7x")).toBe("chains");
    expect(fileKindFor("chains/gtr.yaml")).toBeNull();
    expect(fileKindFor("project.yaml")).toBeNull();
  });

  it("offers a chain's keys, then a node's, a link's and a module's", () => {
    expect(fieldsAt("chain", [])).toEqual([
      "start",
      "ports",
      "bus_only",
      "hidden",
      "input",
      "steps",
      "subchains",
    ]);
    expect(fieldsAt("chain", ["subchains"])).toEqual(["id", "steps"]);
    expect(fieldsAt("chain", ["subchains", "steps"])).toEqual(
      fieldsAt("chain", ["steps"]).filter((f) => f !== "track" && f !== "sub"),
    );
    expect(fieldsAt("chain", ["subchains", "steps", "to"])).toEqual([
      "chain",
      "level",
      "port",
    ]);
    expect(fieldsAt("chain", ["steps"])).toEqual(
      expect.arrayContaining([
        "id",
        "track",
        "to",
        "bypass",
        "extends",
        "params",
      ]),
    );
    expect(fieldsAt("chain", ["steps", "to"])).toEqual([
      "chain",
      "level",
      "port",
    ]);
    expect(fieldsAt("chain", ["steps", "events"])).toEqual(
      fieldsAt("module", ["events"]),
    );
    expect(valuesAt("chain", [], "start")).toEqual(["true", "MIX", "RENDER"]);
    expect(valuesAt("chain", ["steps"], "io")).toEqual(
      valuesAt("module", [], "io"),
    );
  });
});
