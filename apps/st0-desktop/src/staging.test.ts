// A regression test for a bug that had already shipped: ORT_KEEP was pinned to `napi-v3`
// while onnxruntime-node had moved to `napi-v6`, so the prune excluded EVERY binding and the
// bundle carried the JS with no native module. Nothing fails until the first stem split.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { pruneOtherPlatforms } from "../scripts/stage.mjs";

const prune = pruneOtherPlatforms as (rel: string) => boolean;
const ORT = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "node_modules",
  "onnxruntime-node",
  "bin",
);

describe("staging onnxruntime", () => {
  it("keeps at least one real binding for this host", () => {
    if (!existsSync(ORT)) return; // not installed here; the build itself would say so
    const napi = readdirSync(ORT).find((n) => /^napi-v\d+$/.test(n));
    expect(napi).toBeDefined();
    const kept = `bin/${napi}/${process.platform}/${process.arch}/onnxruntime_binding.node`;
    expect(prune(kept)).toBe(false);
  });

  it("drops the other platforms, and any stale napi generation", () => {
    if (!existsSync(ORT)) return;
    const napi = readdirSync(ORT).find((n) => /^napi-v\d+$/.test(n));
    const other = process.platform === "win32" ? "linux" : "win32";
    expect(prune(`bin/${napi}/${other}/x64/onnxruntime_binding.node`)).toBe(
      true,
    );
    expect(
      prune(`bin/napi-v1/${process.platform}/${process.arch}/x.node`),
    ).toBe(true);
  });

  it("carries everything outside bin/ — the JS is not ours to judge", () => {
    expect(prune("lib/index.js")).toBe(false);
    expect(prune("package.json")).toBe(false);
    // Not deep enough to name a platform yet, so it is not dropped on the way down.
    expect(prune("bin")).toBe(false);
  });
});
