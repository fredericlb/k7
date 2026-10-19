// scope.test.ts — a view under a base path edits the same text as the document does, whatever form the base is written in.

import { describe, expect, it } from "vitest";
import { parseDocument } from "./edit.ts";

const TEXT = `graph({
  osc: { type: "saw", level: 1 }, // the source
})
steps([
  id(1).x(2), // a chain
])
tempo(120)
`;

describe("a scoped view", () => {
  it("reads relative to an object base", () => {
    const s = parseDocument(TEXT).at(["graph", "osc"]);
    expect(s.getIn(["type"])).toBe("saw");
    expect(s.hasIn(["level"])).toBe(true);
    expect(s.hasIn(["nope"])).toBe(false);
    expect(s.getNode(["level"])?.kind).toBe("scalar");
    expect(s.getSource(["type"])).toBe('"saw"');
    expect(s.toJS()).toEqual({ type: "saw", level: 1 });
  });

  it("edits an object base, comments kept", () => {
    const d = parseDocument(TEXT);
    const s = d.at(["graph", "osc"]);
    s.setIn(["level"], 0.5);
    s.addIn(["tags"], "warm");
    s.renameKey(["type"], "wave");
    s.deleteIn(["tags"]);
    expect(d.toString()).toBe(
      TEXT.replace('type: "saw", level: 1', 'wave: "saw", level: 0.5'),
    );
  });

  it("edits a chain base", () => {
    const d = parseDocument(TEXT);
    const s = d.at(["steps", 0]);
    s.setIn(["y"], 3);
    s.applyIn(["x"], 4);
    s.renameKey(["id"], "n");
    expect(d.toString()).toBe(TEXT.replace("id(1).x(2)", "n(1).x(4).y(3)"));
    s.deleteIn(["y"]);
    expect(s.toJS()).toEqual({ n: 1, x: 4 });
  });

  it("edits the root as a base, and a list through insertIn", () => {
    const d = parseDocument(TEXT);
    const root = d.at([]);
    root.setIn(["tempo"], 90);
    root.insertIn(["steps"], 0, { id: 0 });
    root.applyIn([], { ...d.toJS(), swing: 0.1 });
    expect(d.toString()).toBe(
      TEXT.replace("tempo(120)", "tempo(90)\nswing(0.1)").replace(
        "  id(1)",
        "  id(0),\n  id(1)",
      ),
    );
  });
});
