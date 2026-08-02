// A widget is dropped on the grid FIRST and given its parameter after, by dragging one onto it — and the
// renderer has always drawn an unbound widget inertly. The schema disagreed, so retyping a widget to a dropdown
// stopped the whole project loading with `ui.widgets.w2.bind: incomplete value !=""`. The intent was already
// written beside `options?`; `bind` just still required a value.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModules } from "./loader";
import { scaffold } from "./scaffold";
import { writeModule } from "./testSupport";

describe("a widget with no bind", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "td-bind-"));
    scaffold(dir, "song");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** Write a module whose UI holds one widget of `type`, with no `bind`. */
  const moduleWith = (type: string, extra: Record<string, unknown> = {}) =>
    writeModule(dir, "audio", "nam", {
      plugin: { type: "internal", name: "nam" },
      ui: {
        cols: 4,
        rows: 2,
        widgets: { w2: { type, col: 0, row: 0, ...extra } },
      },
    });

  // `true` is the flag loadGraph and compileNodeProject pass — the path that actually
  // rejected the file, rather than `cue vet ./...` (which never reaches a package-less
  // module file at all).
  const validate = () => loadModules(dir, true);

  it("loads a dropdown that has not been bound yet", () => {
    moduleWith("dropdown");
    expect(validate).not.toThrow();
    const w = (loadModules(dir) as Record<string, any>).nam?.ui?.widgets?.w2;
    expect(w).toMatchObject({ type: "dropdown", col: 0, row: 0 });
    expect(w.bind).toBeUndefined();
  });

  it("loads every other control unbound too", () => {
    // Same authoring step for all of them; singling out the dropdown would just move the
    // problem to whichever widget you dropped next.
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
    // Optional is not the same as "anything goes": a bind written as "" is a real
    // mistake — it names no parameter and nothing would ever drive the widget.
    moduleWith("knob", { bind: "" });
    expect(validate).toThrow(/bind/);
  });
});
