// What a live input's panel needs to be more than a picture.
//
// An io "in" module runs no plugin, and every widget in the graph is built for one: a knob sends a param to a
// pluginId, a waveform reads a tap keyed by pluginId. Without an answer of its own an input draws its panel and
// nothing in it works — no id to address, no param to send. These are the two answers, both computed here
// because this is the only place that knows both the module and the chain it sits in.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeNode } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

let root: string;
let proj: string;

const IN = "@workspace/io/IN:in-2";
const chains = (modules: Record<string, string[]>) =>
  writeDoc(join(proj, "graph.k7x"), { modules });

/** The step for the live input, wherever the derivation put it. */
const inputStep = () => {
  const g = buildGraphDoc(proj);
  return Object.values(g.chains)
    .flatMap((c) => c.use)
    .find((s) => s.module === IN);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-inwidget-"));
  proj = join(root, "song");
  mkdirSync(join(proj, "nodes"), { recursive: true });
  writeDoc(join(proj, "project.k7x"), {
    project: { name: "song", modules_from: ["../_modules"] },
  });
  writeNode(proj, "gtr", { extends: "@meta/track", events: [] });
  // A module lives at `@workspace` now; "amp" stays the bare NODE name the graph uses.
  writeDoc(join(root, "_modules", "audio", "amp", "module.k7x"), {
    plugin: { type: "internal", name: "Chorus" },
  });
  writeNode(proj, "amp", { extends: "@workspace/audio/amp" });
  // The shared catalogue as `module populate` leaves it: a generic IN, one node per channel.
  writeDoc(join(root, "_modules", "io", "IN", "module.k7x"), { io: "in" });
  writeDoc(join(root, "_modules", "io", "IN", "in-2.k7x"), { channel: [2] });
  chains({ gtr: ["amp"], amp: ["OUT"], [IN]: ["gtr"] });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("a live input's monitor", () => {
  it("comes through as the module's own field", () => {
    // Not a param — there is no plugin to hold one — so it rides on the step itself.
    expect(inputStep()?.monitor).toBe("auto");
    expect(inputStep()?.params).toEqual({});
  });

  it("reads what the module file says", () => {
    writeDoc(join(root, "_modules", "io", "IN", "in-2.k7x"), {
      channel: [2],
      monitor: "on",
    });
    expect(inputStep()?.monitor).toBe("on");
  });

  it("is absent on a module that is not an input", () => {
    // A knob on an ordinary module must not grow a monitor it has no business having.
    const g = buildGraphDoc(proj);
    expect(g.chains.gtr.use.find((s) => s.module === "amp")?.monitor).toBe(
      undefined,
    );
  });
});

describe("a live input's waveform", () => {
  it("listens to the INPUT of the first module on the lane it feeds", () => {
    // The input has no plugin to tap; its signal arrives one step downstream, at the lane's first module.
    expect(inputStep()?.pluginId).toBe(undefined);
    expect(inputStep()?.tap).toEqual({ id: "gtr:amp", side: "input" });
  });

  it("names an id the engine really has", () => {
    // The tap borrows a pluginId, so it must be one actually assigned, not a key nothing ever fills.
    const g = buildGraphDoc(proj);
    const ids = Object.values(g.chains)
      .flatMap((c) => c.use)
      .map((s) => s.pluginId)
      .filter(Boolean);
    expect(ids).toContain(inputStep()?.tap?.id);
  });

  it("has none when the lane runs no plugins", () => {
    // The widget draws its empty box, which is honest, instead of listening to a key nothing writes.
    chains({ gtr: ["OUT"], [IN]: ["gtr"] });
    expect(inputStep()?.tap).toBe(undefined);
  });

  it("follows the input when it sits INSIDE the lane's run instead", () => {
    // The other way of wiring one, which the migration writes. Same lane, same tap.
    chains({ gtr: [IN], [IN]: ["amp"], amp: ["OUT"] });
    expect(inputStep()?.tap).toEqual({ id: "gtr:amp", side: "input" });
  });
});
