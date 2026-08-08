import { describe, expect, it } from "vitest";
import { modulePreviewDoc, previewPluginId, readPluginBlock } from "./preview";

// Reading `plugin:` without a YAML parser is the one piece here that can fail SILENTLY —
// a regex that matches nothing yields an empty parameter list, which looks exactly like a
// module that has no parameters. Both spellings in the repo's own files are covered.
describe("reading the plugin block", () => {
  it("reads the indented block form", () => {
    expect(
      readPluginBlock("plugin:\n  type: vst3\n  name: Big Hall\nparams: {}\n"),
    ).toEqual({ type: "vst3", name: "Big Hall" });
  });

  it("reads the inline flow form", () => {
    expect(readPluginBlock("plugin: {type: internal, name: 4OSC}\n")).toEqual({
      type: "internal",
      name: "4OSC",
    });
  });

  it("stops at the end of the block instead of swallowing the next key", () => {
    // The bug this guards: a greedy match ran past `plugin:` into `params:` and picked up
    // a `name:` belonging to something else.
    expect(
      readPluginBlock("plugin:\n  type: vst3\nrack:\n  name: Not This\n"),
    ).toEqual({ type: "vst3", name: undefined });
  });

  it("gives nothing for a module with no plugin at all", () => {
    expect(readPluginBlock("io: out\n")).toBeUndefined();
    expect(readPluginBlock("")).toBeUndefined();
  });

  it("survives quotes and trailing comments", () => {
    expect(readPluginBlock('plugin:\n  type: "vst3"\n  name: "A B"\n')).toEqual(
      {
        type: "vst3",
        name: "A B",
      },
    );
  });
});

// The smallest document that makes a plugin exist. What it must get right is the wire
// mapping — an authored `plugin: {type: internal, name: 4OSC}` is NOT what the engine
// reads; enginePlugin swaps the two round, and getting it wrong loads nothing at all.

describe("the one-module preview document", () => {
  it("maps a built-in onto the engine's wire form", () => {
    const doc = modulePreviewDoc("synth", { type: "internal", name: "4OSC" });
    const p = doc.tracks[0].plugins[0];
    // `internal` means the NAME is the engine's type, and the module name is the label.
    expect(p.type).toBe("4OSC");
    expect(p.name).toBe("synth");
  });

  it("leaves an external plugin's format as the type", () => {
    const doc = modulePreviewDoc("reverb", { type: "vst3", name: "Big Hall" });
    const p = doc.tracks[0].plugins[0];
    expect(p.type).toBe("vst3");
    expect(p.name).toBe("Big Hall");
  });

  it("falls back to the module name when the plugin has none", () => {
    const doc = modulePreviewDoc("thing", { type: "vst3" });
    expect(doc.tracks[0].plugins[0].name).toBe("thing");
  });

  it("survives a module with no plugin block", () => {
    // An io module, or a half-written file. It must produce a document, not throw — the
    // editor keeps working, the parameter list is simply empty.
    const doc = modulePreviewDoc("desk", undefined);
    expect(doc.tracks[0].plugins).toHaveLength(1);
    expect(doc.tracks[0].plugins[0].type).toBe("");
  });

  it("addresses the plugin the way the engine will", () => {
    const doc = modulePreviewDoc("synth", { type: "internal", name: "4OSC" });
    expect(doc.tracks[0].plugins[0].id).toBe(previewPluginId("synth"));
    expect(previewPluginId("synth")).toBe("preview:synth");
  });

  it("refuses to arm, by carrying no record directory", () => {
    // A preview plays and never records; a made-up path would be a lie the engine would
    // eventually try to write into. See emptyDoc.
    expect(modulePreviewDoc("synth", undefined).recordDir).toBe("");
  });

  it("carries no groups, which is why it can be sent unfolded", () => {
    // It used to assert no PICTURE either. There is no such field to assert on any more —
    // a ProjectDoc carries none since picture became v1's own document.
    const doc = modulePreviewDoc("synth", undefined);
    expect(doc.groups).toEqual([]);
  });
});
