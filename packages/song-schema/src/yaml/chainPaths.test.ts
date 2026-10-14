// A chain project's files classified by path: a chain file is checked as one and offers a chain's
// fields, a lane file is a module file, and the older names keep their old kinds.

import { describe, expect, it } from "vitest";
import { fieldsAt, fileKindFor, valuesAt } from "./fields";
import { validateFile } from "./validate";

const CHAIN =
  'start: true\nsteps:\n  - { id: l1, track: gtr }\n  - { id: a1, extends: "@k7-core/audio/chorus" }\n  - to: [ { chain: MIX } ]\n';

describe("validateFile", () => {
  it("checks chains/<name>.yaml as a chain file", () => {
    expect(validateFile("song/chains/gtr.yaml", CHAIN)).toMatchObject({
      ok: true,
      depth: "schema",
    });
    const bad = validateFile(
      "chains/gtr.yaml",
      "steps:\n  - { id: l1, track: gtr }\n",
    );
    expect(bad.ok).toBe(false);
  });

  it("checks tracks/<lane>.yaml as a module file", () => {
    const v = validateFile("tracks/gtr.yaml", "extends: 3\n");
    expect(v.depth).toBe("schema");
    expect(v.ok).toBe(false);
  });

  it("keeps a library chain folder's graph.yaml and nodes/ as they were read", () => {
    expect(
      validateFile("_libraries/k7-core/chains/verb/graph.yaml", "modules: {}\n")
        .ok,
    ).toBe(true);
    expect(
      validateFile(
        "_libraries/k7-core/chains/verb/nodes/v.yaml",
        "extends: 3\n",
      ).ok,
    ).toBe(false);
  });
});

describe("fileKindFor", () => {
  it("names a chain file, a lane file and the older segments files", () => {
    expect(fileKindFor("chains/gtr.yaml")).toBe("chain");
    expect(fileKindFor("tracks/gtr.yaml")).toBe("module");
    expect(fileKindFor("video_tracks/cam.yaml")).toBe("video_track");
    expect(fileKindFor("chains.yaml")).toBe("chains");
    expect(fileKindFor("chains/verb/graph.yaml")).toBe("chains");
  });

  it("offers a chain's keys, then a node's, a link's and a module's", () => {
    expect(fieldsAt("chain", [])).toEqual([
      "start",
      "ports",
      "bus_only",
      "hidden",
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
