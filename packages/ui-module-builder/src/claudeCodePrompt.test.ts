// The prompt AI organize copies for a local Claude Code session: the same brief and module as the
// API's, and in place of a JSON answer, WHICH files to write and where — a repository and a path in it.

import type { AiOrganizeRequest } from "@studio/panel-rules/ai-organize";
import { describe, expect, it } from "vitest";
import { claudeCodePrompt, whereIs } from "./claudeCodePrompt";

const req = (
  mode: "update" | "reset",
  direction: string,
): AiOrganizeRequest => ({
  module: "filter",
  moduleYaml: "",
  params: [{ name: "Cutoff" }, { name: "Resonance" }],
  uiYaml:
    "cols: 8\nrows: 5\nwidgets:\n  cut: { type: knob, col: 0, row: 0, bind: Cutoff }\n",
  widgetsJs: "export default {};\n",
  mode,
  direction,
});

describe("where a file is, for somebody in a checkout", () => {
  it("names the workspace repository for a workspace path", () => {
    expect(whereIs("_modules/filters/lp/ui.yaml")).toBe(
      "`_modules/filters/lp/ui.yaml` in the workspace repository",
    );
  });

  it("names the LIBRARY repository, and the path inside it, for a library module", () => {
    expect(whereIs("_libraries/k7-core/modules/audio/lp/ui.yaml")).toBe(
      "`modules/audio/lp/ui.yaml` in the `k7-core` library repository",
    );
  });
});

describe("the prompt", () => {
  const files = {
    ui: "_libraries/k7-core/modules/audio/lp/ui.yaml",
    script: "_libraries/k7-core/modules/audio/lp/widgets.js",
  };

  it("says which files to write, and to write them directly", () => {
    const text = claudeCodePrompt(req("update", "bigger cutoff"), files);
    expect(text).toContain(
      "`modules/audio/lp/ui.yaml` in the `k7-core` library repository",
    );
    expect(text).toContain(
      "`modules/audio/lp/widgets.js` in the `k7-core` library repository",
    );
    expect(text).toContain("Write the panel DIRECTLY into its file");
    expect(text).toContain("Touch no other file");
  });

  it("carries the update — the panel there is and what to change — as the API's does", () => {
    const text = claudeCodePrompt(req("update", "bigger cutoff"), files);
    expect(text).toContain("## Current ui.yaml");
    expect(text).toContain("## What to change\nbigger cutoff");
  });

  it("asks for no JSON: the API's answer section is not in it", () => {
    const text = claudeCodePrompt(req("reset", ""), files);
    expect(text).not.toContain("A JSON object with");
    expect(text).not.toContain("## Current ui.yaml");
  });

  it("lists the binds the builder will accept", () => {
    expect(claudeCodePrompt(req("reset", ""), files)).toContain(
      "`Cutoff`, `Resonance`",
    );
  });

  it("forbids screens when the module keeps no widgets.js", () => {
    const text = claudeCodePrompt(req("reset", ""), {
      ui: files.ui,
      script: null,
    });
    expect(text).toContain("the panel must draw no lcdscreen");
    expect(text).not.toContain("widgets.js`:");
  });
});
