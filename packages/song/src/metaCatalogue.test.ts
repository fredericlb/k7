// metaCatalogue.test.ts — every built-in a `@meta` module names is one the engine CATALOGUES, read
// from the C++ source: a project's needs are scored against that catalogue, so an uncatalogued one
// reads as "this engine is missing" on an engine that plays it (engine/k7-runtime/docs/plugins.md).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const engineSrc = join(here, "../../../engine/k7-runtime/engine");
const metaDir = join(here, "../meta");

function* files(dir: string, ext: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* files(p, ext);
    else if (p.endsWith(ext)) yield p;
  }
}

/** The internal plugins the `@meta` modules name, as they name them. */
function metaInternals(): string[] {
  const out: string[] = [];
  for (const f of files(metaDir, ".k7x")) {
    const m = /plugin\(\{\s*type:\s*"internal",\s*name:\s*"([^"]+)"/.exec(
      readFileSync(f, "utf8"),
    );
    if (m) out.push(m[1]);
  }
  return out;
}

/** Every name `builtInPlugins()` answers to: each entry's display name and its class's xmlTypeName. */
function catalogued(): Set<string> {
  const scan = readFileSync(join(engineSrc, "PluginScan.cpp"), "utf8");
  const body = scan.slice(
    scan.indexOf("std::vector<PluginInfo> builtInPlugins()"),
    scan.indexOf("std::vector<PluginInfo> airWindowsPlugins()"),
  );
  const typeOf = new Map<string, string>();
  for (const f of files(engineSrc, ".cpp"))
    for (const m of readFileSync(f, "utf8").matchAll(
      /const char\* (\w+)::xmlTypeName = "([^"]+)"/g,
    ))
      typeOf.set(m[1], m[2]);
  const names = new Set<string>();
  for (const m of body.matchAll(
    /e\("([^"]+)",\s*studio::(\w+)::xmlTypeName/g,
  )) {
    names.add(m[1]);
    const type = typeOf.get(m[2]);
    if (type) names.add(type);
  }
  return names;
}

describe("the @meta modules' built-ins", () => {
  it("are all in the engine's catalogue", () => {
    const listed = catalogued();
    expect(listed.size).toBeGreaterThan(5);
    expect(metaInternals().filter((n) => !listed.has(n))).toEqual([]);
  });
});
