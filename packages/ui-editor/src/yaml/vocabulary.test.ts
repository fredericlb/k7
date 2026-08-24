// chains.yaml is the one project file whose values are almost entirely NAMES the project
// invented — tracks, modules, sinks. No Zod enum can hold those, so they come off the
// hints instead, and this is where the two halves are wired together.
//
// The file declares segments, so the vocabulary is POSITIONAL: a key under
// `tracks:`/`modules:` is a node's own name, and what follows it is a list of
// destinations. There are no field names left to key on.

import type { Hints } from "@studio/web-protocol";
import { describe, expect, it } from "vitest";
import { schemaVocabulary } from "./vocabulary";

const HINTS = {
  baseModules: ["@engine/de-rez", "@st0/audio/utility/mixer"],
  modules: ["synth", "synth:lead", "OUT", "@engine/audio/amp/nam"],
  tracks: ["melody", "pad"],
  videoTracks: ["clip1"],
  chains: ["melody", "reverb"],
  sequences: ["riff"],
  clips: ["take1"],
  ioSinks: ["OUT", "@engine/io/desk"],
} as unknown as Hints;

const at = (path: string, keyPath: string[], field: string, hints?: Hints) =>
  schemaVocabulary(path, hints).valuesAt?.(keyPath, field) ?? [];

describe("the chains vocabulary", () => {
  it("offers the modules and sinks a node can feed", () => {
    // The key is the node's own name, so what is completed is where its signal goes.
    expect(at("chains.yaml", ["modules"], "amp", HINTS)).toEqual(
      expect.arrayContaining([
        "synth:lead",
        "@engine/audio/amp/nam",
        "@engine/io/desk",
      ]),
    );
    // `OUT` is both a module of the project and an io sink — offered once, not twice.
    expect(
      at("chains.yaml", ["modules"], "amp", HINTS).filter((v) => v === "OUT"),
    ).toEqual(["OUT"]);
  });

  // A live input is the node its run STARTS at, so a segment leaving a module has one destination more.
  it("offers the tracks too, for a segment leaving a module", () => {
    expect(at("chains.yaml", ["modules"], "@engine/io/IN:in-1", HINTS)).toEqual(
      expect.arrayContaining(["melody", "pad", "OUT", "synth:lead"]),
    );
  });

  it("does NOT offer a track under `tracks:` — no track feeds another", () => {
    expect(at("chains.yaml", ["tracks"], "melody", HINTS)).not.toEqual(
      expect.arrayContaining(["pad"]),
    );
  });

  it("offers the same under `tracks:` — a track's first hop is a module too", () => {
    expect(at("chains.yaml", ["tracks"], "melody", HINTS)).toEqual(
      expect.arrayContaining(["synth:lead", "OUT"]),
    );
  });

  it("does NOT offer a chain name as a destination", () => {
    // A bus is reached by naming the module it starts at — see docs/completion.md.
    expect(at("chains.yaml", ["modules"], "amp", HINTS)).not.toContain(
      "reverb",
    );
  });

  it("offers modules for `bypassed`, and nothing else", () => {
    // Neither a track nor a sink belongs in a list of things the signal skips.
    const v = at("chains.yaml", [], "bypassed", HINTS);
    expect(v).toEqual(HINTS.modules);
    expect(v).not.toContain("melody");
  });

  it("says nothing without hints, rather than guessing", () => {
    // The editor mounts before the first hints arrive, and an empty list means "free text".
    expect(at("chains.yaml", ["modules"], "amp")).toEqual([]);
  });

  it("offers what a module may extend", () => {
    // The schema deliberately says nothing here, so without this layer `extends:` completed against nothing.
    const path = "modules/audio/amp/module.yaml";
    expect(at(path, [], "extends", HINTS)).toEqual([
      "@engine/de-rez",
      "@st0/audio/utility/mixer",
    ]);
    // Only at the top level and only for that field, since `params:` is a free map.
    expect(at(path, ["rack"], "extends", HINTS)).toEqual([]);
    expect(at(path, [], "docs", HINTS)).toEqual([]);
  });

  it("does not spill the chain vocabulary into another kind of file", () => {
    // A module.yaml keeps its own enums: a project value may only ever fill a field a schema left open.
    expect(
      schemaVocabulary("modules/audio/amp/module.yaml", HINTS).valuesAt?.(
        [],
        "type",
      ),
    ).toEqual(["plugin", "rack", "video_effect", "video_transition"]);
    // A NODE file, which is what a lane is (packages/song/docs/trackModules.md).
    expect(
      schemaVocabulary("nodes/melody.yaml", HINTS).valuesAt?.(
        ["modules"],
        "amp",
      ),
    ).toEqual([]);
  });
});
