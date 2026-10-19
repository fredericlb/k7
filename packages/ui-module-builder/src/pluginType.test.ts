import { describe, expect, it } from "vitest";
import { pluginTypeOf } from "./ModuleBuilder";

// What decides whether the DSP tab is drawn, read off the BUFFER on every keystroke — docs/builder.md.

describe("the plugin type a module file declares", () => {
  it("reads the object form, past the comments above it", () => {
    // The real shape — this is what the library's auto-wah looks like.
    expect(
      pluginTypeOf(
        [
          "// Auto Wah [audioEffect] — a touch wah.",
          "// Its DSP is described in auto-wah.ts beside this file.",
          'plugin({ type: "jsdsp", name: "Auto Wah" })',
          "",
        ].join("\n"),
      ),
    ).toBe("jsdsp");
  });

  it("reads the object form spread over lines, and a quoted key", () => {
    expect(pluginTypeOf('plugin({\n  name: "X",\n  type: "faust",\n})\n')).toBe(
      "faust",
    );
    expect(pluginTypeOf('plugin({ "type": "jsdsp" })\n')).toBe("jsdsp");
  });

  it("reads the chain form", () => {
    expect(pluginTypeOf('plugin(type("jsdsp").name("X"))\n')).toBe("jsdsp");
  });

  it("is not fooled by a type BELOW the plugin statement", () => {
    // `type(…)` is also a module's own top-level field, and reading that would call every rack a jsdsp.
    expect(pluginTypeOf('plugin({ name: "X" })\ntype("rack")\n')).toBe("");
  });

  it("answers nothing for a module with no plugin statement", () => {
    expect(pluginTypeOf('extends("@engine/mixer")\n')).toBe("");
    expect(pluginTypeOf("")).toBe("");
  });

  it("keeps its answer while the next line is still being typed", () => {
    expect(pluginTypeOf('plugin({\n  type: "jsdsp",\n  nam')).toBe("jsdsp");
  });

  it("does NOT accept a misspelt type", () => {
    // `jsdp` is one keystroke away and means nothing: two spellings that both "work" is worse.
    expect(pluginTypeOf('plugin({ type: "jsdp" })\n')).toBe("jsdp");
  });
});
