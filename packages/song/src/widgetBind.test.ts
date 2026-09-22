// A widget is dropped on the grid FIRST and given its parameter after, by dragging one onto it — and the
// renderer draws an unbound widget inertly. The schema has to agree: a `bind` required to be non-empty
// refuses the whole project with `ui.widgets.w2.bind: incomplete value !=""` the moment a widget is retyped
// to a dropdown. The intent is written beside `options?`.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { writeNode } from "./testSupport";

describe("a widget with no bind", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-bind-"));
    writeFileSync(
      join(dir, "project.yaml"),
      "project:\n  name: song\n  tempo: 120\n",
      "utf8",
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Write a node whose UI holds one widget of `type`, with no `bind`. */
  const moduleWith = (type: string, extra: Record<string, unknown> = {}) =>
    writeNode(dir, "nam", {
      plugin: { type: "internal", name: "nam" },
      ui: {
        cols: 4,
        rows: 2,
        widgets: { w2: { type, col: 0, row: 0, ...extra } },
      },
    });

  // `true` is the flag loadGraph and compileNodeProject pass: the path that rejects the file.
  const validate = () => loadModules(dir, true);

  it("loads a dropdown that has not been bound yet", () => {
    moduleWith("dropdown");
    expect(validate).not.toThrow();
    const w = (loadModules(dir) as Record<string, any>).nam?.ui?.widgets?.w2;
    expect(w).toMatchObject({ type: "dropdown", col: 0, row: 0 });
    expect(w.bind).toBeUndefined();
  });

  it("loads every other control unbound too", () => {
    // One authoring step for all: singling one out moves the problem to the next widget.
    for (const type of [
      "knob",
      "slider",
      "fader",
      "number",
      "toggle",
      "button",
      "meter",
    ]) {
      moduleWith(type);
      expect(validate, `${type} with no bind`).not.toThrow();
    }
  });

  it("still rejects an EMPTY bind", () => {
    // Optional is not "anything goes": `bind: ""` names no parameter and drives nothing.
    moduleWith("knob", { bind: "" });
    expect(validate).toThrow(/bind/);
  });
});
