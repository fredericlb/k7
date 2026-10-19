// The shell's panes are memoised and stay mounted while hidden, so App must hand them nothing it
// rebuilds per render: an inline closure or literal re-renders a hidden pane on every caret move.
// Read as TEXT, since nothing here mounts App; the callbacks live in hooks/usePaneCallbacks.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const app = readFileSync(join(here, "App.tsx"), "utf8");

const PANES = [
  "TimelineTab",
  "ChainsTab",
  "EditorTab",
  "SurfaceTab",
  "MasteringTab",
  "ViewportTab",
];

/** The props of every `<Name …/>` in App.tsx, comment lines dropped. */
function propsOf(name: string): string[] {
  const out: string[] = [];
  for (const at of app.matchAll(new RegExp(`<${name}\\b`, "g"))) {
    const end = app.indexOf("/>", at.index);
    const block = app.slice(at.index, end);
    out.push(
      block
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n"),
    );
  }
  return out;
}

describe("the props App hands its panes", () => {
  for (const name of PANES) {
    it(`${name} gets no inline closure or literal`, () => {
      const blocks = propsOf(name);
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) {
        expect(b, `${name}: an arrow`).not.toContain("=>");
        expect(b, `${name}: a function`).not.toMatch(/\bfunction\b/);
        expect(b, `${name}: an object literal`).not.toMatch(/=\{\s*\{/);
        expect(b, `${name}: an array literal`).not.toMatch(/=\{\s*\[/);
        expect(b, `${name}: a JSX element`).not.toMatch(/=\{\s*\(?\s*</);
      }
    });
  }
});

describe("the panes themselves", () => {
  const files: Record<string, string> = {
    TimelineTab: "components/TimelineTab.tsx",
    ChainsTab: "components/ChainsTab.tsx",
    EditorTab: "components/EditorTab.tsx",
    SurfaceTab: "components/SurfaceTab.tsx",
    MasteringTab: "components/MasteringTab.tsx",
    ViewportTab: "../../../../packages/k7-plugins/src/video/index.ts",
  };
  for (const [name, file] of Object.entries(files)) {
    it(`${name} is exported memoised`, () => {
      const src = readFileSync(join(here, file), "utf8");
      expect(src).toMatch(new RegExp(`export const ${name} = memo\\(`));
    });
  }
});
