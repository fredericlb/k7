// vitePlugin.test.ts — which chunks the built page preloads: appMain's static closure, not the entry's.

import { describe, expect, it } from "vitest";
import { type PreloadChunk, preloadFiles } from "./vitePlugin.ts";

const chunk = (
  fileName: string,
  imports: string[] = [],
  extra: Partial<PreloadChunk> = {},
): PreloadChunk => ({ type: "chunk", fileName, imports, ...extra });

describe("preloadFiles", () => {
  const bundle: Record<string, PreloadChunk> = {
    "main.js": chunk("main.js", ["shared.js"], { isEntry: true }),
    "shared.js": chunk("shared.js"),
    "appMain.js": chunk("appMain.js", ["shared.js", "react.js"], {
      facadeModuleId: "C:\\k7\\apps\\k7\\frontend\\src\\appMain.tsx",
    }),
    "react.js": chunk("react.js", ["scheduler.js"]),
    "scheduler.js": chunk("scheduler.js"),
    "App.js": chunk("App.js", ["react.js"]),
    "style.css": { type: "asset", fileName: "style.css" },
  };

  it("preloads appMain and what it imports, past what the entry already has", () => {
    expect(preloadFiles(bundle, "/src/appMain.tsx").sort()).toEqual([
      "appMain.js",
      "react.js",
      "scheduler.js",
    ]);
  });

  it("preloads nothing when the entry is not in the bundle", () => {
    expect(preloadFiles(bundle, "/src/missing.tsx")).toEqual([]);
  });
});
