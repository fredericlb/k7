import type { WebWidget } from "@studio/graph-model";
import { describe, expect, it } from "vitest";
import {
  GROUP_EDGE_INSET,
  GROUP_FIELD_INSET,
  groupEdgeInsets,
} from "./groupEdge";

const ws = (m: Record<string, Partial<WebWidget>>): Record<string, WebWidget> =>
  m as Record<string, WebWidget>;

describe("groupEdgeInsets", () => {
  const panel = ws({
    g: {
      type: "group",
      col: 2,
      row: 0,
      colSpan: 6,
      rowSpan: 3,
      label: "FILTER",
    },
    a: { type: "knob", col: 2, row: 0, colSpan: 2, rowSpan: 2, bind: "Cutoff" },
    b: { type: "knob", col: 4, row: 0, colSpan: 2, rowSpan: 2, bind: "Res" },
    d: { type: "dropdown", col: 6, row: 0, colSpan: 2, bind: "Type" },
    out: { type: "knob", col: 0, row: 0, colSpan: 2, rowSpan: 2, bind: "Gain" },
  });

  it("insets the controls in a named group's first column", () => {
    expect([...groupEdgeInsets(panel)]).toEqual([["a", GROUP_EDGE_INSET]]);
  });

  it("insets a field on the edge further, whatever its row", () => {
    const corner = ws({ ...panel, a: { ...panel.a, type: "dropdown" } });
    expect([...groupEdgeInsets(corner)]).toEqual([["a", GROUP_FIELD_INSET]]);
    const lower = ws({
      ...panel,
      a: { type: "number", col: 2, row: 2, colSpan: 2, bind: "Drive" },
    });
    expect([...groupEdgeInsets(lower)]).toEqual([["a", GROUP_FIELD_INSET]]);
  });

  it("insets under a switch too, and not under a bare frame", () => {
    const bare = ws({ ...panel, g: { ...panel.g, label: undefined } });
    expect(groupEdgeInsets(bare).size).toBe(0);
    const sw = ws({
      ...panel,
      g: { ...panel.g, label: undefined, bind: "On" },
    });
    expect([...groupEdgeInsets(sw).keys()]).toEqual(["a"]);
  });
});
