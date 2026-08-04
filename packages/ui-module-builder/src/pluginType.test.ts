import { describe, expect, it } from "vitest";
import { pluginTypeOf } from "./ModuleBuilder";

// What decides whether the `jsdsp.ts` tab is drawn. Read off the BUFFER on every keystroke, so
// it has to answer while the document is half-typed — which is why it is a regex and not the
// YAML parser: a tab that blinked out on an unfinished line would be worse than a loose read.

describe("the plugin type a module file declares", () => {
  it("reads the block form, past the comments above it", () => {
    // The real shape — this is what the médiathèque's auto-wah looks like.
    expect(
      pluginTypeOf(
        [
          "# Auto Wah [audioEffect] — a touch wah.",
          "# Its DSP is described in jsdsp.ts beside this file.",
          "plugin:",
          "  type: jsdsp",
          "  name: Auto Wah",
          "",
        ].join("\n"),
      ),
    ).toBe("jsdsp");
  });

  it("reads the inline form", () => {
    expect(pluginTypeOf("plugin: { type: jsdsp, name: X }\n")).toBe("jsdsp");
  });

  it("reads a quoted value", () => {
    expect(pluginTypeOf('plugin:\n  type: "jsdsp"\n')).toBe("jsdsp");
  });

  it("is not fooled by a type BELOW the plugin block", () => {
    // `type:` is also a module's own top-level field (plugin | rack | video_effect), and reading
    // that one would call every rack a jsdsp module.
    expect(pluginTypeOf("plugin:\n  name: X\ntype: rack\n")).toBe("");
  });

  it("answers nothing for a module with no plugin block", () => {
    expect(pluginTypeOf('extends: "@engine/mixer"\n')).toBe("");
    expect(pluginTypeOf("")).toBe("");
  });

  it("keeps its answer while the next line is still being typed", () => {
    expect(pluginTypeOf("plugin:\n  type: jsdsp\n  nam")).toBe("jsdsp");
  });

  it("does NOT accept a misspelt type", () => {
    // `jsdp` is one keystroke away and means nothing. Accepting it as an alias would make the
    // library's two spellings both "work" and neither correct.
    expect(pluginTypeOf("plugin:\n  type: jsdp\n")).toBe("jsdp");
  });
});
