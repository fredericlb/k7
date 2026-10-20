// a11y.test.tsx — the names and roles a test selecting by role finds on the graph: a cable's `+`,
// the preset dropdown, a tapped widget. Read off the element tree, since this package runs no DOM.

import { buildCableGeom } from "@studio/ui-chains/cables";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Cables, type EdgeGeom } from "./ChainsCables";
import { PresetButton } from "./PresetButton";
import { tapName } from "./widgetTarget";

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every host element's props in a tree of elements, depth first. */
function allProps(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(allProps);
  if (!isValidElement(node)) return [];
  const p = node.props as Props;
  return [p, ...allProps(p.children)];
}

const edge: EdgeGeom = {
  ...buildCableGeom([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]),
  id: "e1",
  source: "osc",
  target: "pad",
  insert: { before: "osc", after: "pad" },
};

// The memo's inner function, called as React would: it uses no hook.
const render = Cables as unknown as {
  type: (p: Parameters<typeof Cables>[0]) => ReactNode;
};
const cables = (onInsert?: () => void) =>
  allProps(
    render.type({
      signal: [edge],
      auto: [],
      showLabels: false,
      hovered: null,
      setHovered: () => {},
      onInsert,
    }),
  );

describe("a cable's insert button", () => {
  it("is a named, focusable button even with no pointer over it", () => {
    const btn = cables(() => {}).find((p) => p.role === "button");
    expect(btn?.["aria-label"]).toBe("Add a module between osc and pad");
    expect(btn?.tabIndex).toBe(0);
    expect(typeof btn?.onKeyDown).toBe("function");
  });

  it("is not drawn without a host to answer it", () => {
    expect(cables().some((p) => p.role === "button")).toBe(false);
  });
});

describe("the preset dropdown", () => {
  const label = (current?: string) =>
    allProps(PresetButton({ module: "pad", current, onPresets: () => {} }))
      .map((p) => p["aria-label"])
      .find(Boolean);

  it("is named after the preset it holds", () => {
    expect(label("Warm")).toBe("preset: Warm");
  });

  it("is named `preset` while none is loaded", () => {
    expect(label()).toBe("preset");
  });
});

describe("tapName", () => {
  it("names a recorder's buttons by their verb, not their glyph", () => {
    const w = { type: "button", label: "●", bind: "@rec:record" } as never;
    const rec = (verb: "record" | "clear" | "save") =>
      tapName(w, { kind: "recorder", module: "rec", verb }, null);
    expect([rec("record"), rec("clear"), rec("save")]).toEqual([
      "Record",
      "Clear",
      "Save",
    ]);
  });

  it("names a pad by its symbol and anything else by its face", () => {
    const w = { type: "button", label: "go" } as never;
    expect(tapName(w, null, "kick")).toBe("kick");
    expect(tapName(w, null, null)).toBe("go");
  });
});
