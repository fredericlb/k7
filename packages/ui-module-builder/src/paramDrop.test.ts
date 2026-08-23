// Which widgets a dragged parameter may be dropped on, and what the payload survives.
// Both halves of the gesture are pure and neither is exercised by anything else: the grid's
// half of it only ever runs inside a `dragover` handler, where a wrong answer is invisible —
// a `dragover` that does not preventDefault is a drop the browser refuses with no error.

import { describe, expect, it } from "vitest";
import { isParamDrag, readParamDrag, setParamDrag } from "./paramDrag";
import { bindable } from "./WidgetGridEditor";

// The three calls a drag makes on a DataTransfer, and nothing else — enough to run the real ones.
function fakeTransfer(): DataTransfer {
  const data: Record<string, string> = {};
  return {
    setData: (t: string, v: string) => {
      data[t] = v;
    },
    getData: (t: string) => data[t] ?? "",
    get types() {
      return Object.keys(data);
    },
    effectAllowed: "none",
  } as unknown as DataTransfer;
}

describe("which widget takes a dropped parameter", () => {
  // A dropdown matters for `@base`: the intrinsic is discrete, so binding it by hand needs one.
  it.each([
    "knob",
    "slider",
    "fader",
    "number",
    "toggle",
    "button",
    "meter",
    "dropdown",
    "filepicker",
  ] as const)("takes it on a %s", (type) => {
    expect(bindable({ type })).toBe(true);
  });

  it.each(["label", "tabs", "waveform"] as const)(
    "refuses it on a %s",
    (type) => {
      // These carry no `bind`, and it is the ONLY reason the grid ever bounces a parameter.
      expect(bindable({ type })).toBe(false);
    },
  );
});

describe("the payload, for the intrinsic with the most in it", () => {
  // `@base`'s range is a LIST of names, and losing it silently binds a dropdown with no entries.
  const base = {
    name: "@base",
    meta: {
      min: 0,
      max: 2,
      states: [
        { label: "none", value: 0 },
        { label: "warm", value: 1 },
        { label: "bright", value: 2 },
      ],
    },
  };

  it("is recognised in flight, when only the types are readable", () => {
    const dt = fakeTransfer();
    setParamDrag(dt, base);
    // `dragover` cannot read the data — the browser hides it — so this is all the grid has to go on.
    expect(isParamDrag(dt)).toBe(true);
  });

  it("carries the whole settings list to the drop", () => {
    const dt = fakeTransfer();
    setParamDrag(dt, base);
    expect(readParamDrag(dt)).toEqual(base);
  });

  it("is not confused with a text or file drag", () => {
    const dt = fakeTransfer();
    dt.setData("text/plain", "@base");
    expect(isParamDrag(dt)).toBe(false);
    expect(readParamDrag(dt)).toBeNull();
  });
});
