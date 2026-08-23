import { describe, expect, it } from "vitest";
import { inputUI } from "./graph";

// The panel a live INPUT node draws — synthesised, all dropdowns, `arg` WRITTEN. docs/graphBuild.md.

const mono = (n: number) => ({ name: `Input ${n}`, channels: [n] });
const RIG = [1, 2, 3, 4].map(mono);

const opt = (ui: ReturnType<typeof inputUI>, id: string) =>
  ui.widgets[id]?.options ?? [];

describe("the socket dropdown", () => {
  it("offers the interface's MONO inputs for a mono module", () => {
    const ui = inputUI(RIG, [2]);
    expect(opt(ui, "channel").map((o) => o.label)).toEqual([
      "Input 1",
      "Input 2",
      "Input 3",
      "Input 4",
    ]);
    // What gets written, which is the half that matters.
    expect(opt(ui, "channel").map((o) => o.arg)).toEqual(["1", "2", "3", "4"]);
  });

  it("offers the interface's STEREO devices for a stereo module", () => {
    const rig = [{ name: "Input 1 + 2", channels: [1, 2] }, mono(3)];
    const ui = inputUI(rig, [1, 2]);
    expect(opt(ui, "channel").map((o) => o.label)).toEqual(["Input 1 + 2"]);
    expect(opt(ui, "channel")[0].arg).toBe("1,2");
  });

  it("is empty, without throwing, when no interface is answering", () => {
    const ui = inputUI([], [2]);
    expect(opt(ui, "channel")).toEqual([]);
    // …and the other two still draw: an input with no engine is still an input.
    expect(opt(ui, "width")).toHaveLength(2);
    expect(opt(ui, "monitor")).toHaveLength(3);
  });
});

describe("the width dropdown", () => {
  it("writes the channel field too — mono and stereo are one setting's width", () => {
    // Not a field of its own: it binds `@channel` like the socket does, so nothing can disagree.
    const ui = inputUI(RIG, [2]);
    expect(ui.widgets.width.bind).toBe("@channel");
    expect(opt(ui, "width")).toEqual([
      { label: "mono", value: 0, arg: "2" },
      { label: "stereo", value: 1, arg: "1,2" },
    ]);
  });

  it("pairs on the EVEN/ODD boundary, from either half", () => {
    // The interface groups no other way, so the pair containing 4 is 3+4 — never 4+5.
    expect(opt(inputUI(RIG, [4]), "width")[1].arg).toBe("3,4");
    expect(opt(inputUI(RIG, [3]), "width")[1].arg).toBe("3,4");
  });

  it("narrows a stereo module back to its FIRST channel", () => {
    expect(opt(inputUI(RIG, [3, 4]), "width")[0].arg).toBe("3");
  });

  it("assumes channel 1 for an input that names none", () => {
    const w = opt(inputUI(RIG, undefined), "width");
    expect([w[0].arg, w[1].arg]).toEqual(["1", "1,2"]);
  });
});

describe("the panel as a whole", () => {
  it("binds every widget to a module field, never to a plugin param", () => {
    // An io module runs no plugin — a bare bind would name nothing to send to.
    const ui = inputUI(RIG, [1]);
    for (const w of Object.values(ui.widgets)) {
      expect(w.bind?.startsWith("@")).toBe(true);
      expect(w.type).toBe("dropdown");
    }
  });

  it("offers no gain knob, which could not commit", () => {
    // A knob bound to a module FIELD writes nothing, so `@gain` is absent. See docs/graphBuild.md.
    expect(Object.keys(inputUI(RIG, [1]).widgets).sort()).toEqual([
      "channel",
      "monitor",
      "width",
    ]);
  });
});
