// The catalogue is GENERATED and committed, which buys a seed that works inside an esbuild
// bundle and costs the one failure mode of every generated-and-committed file: it can go stale
// and nothing says so. This is what says so. Same arrangement autowah.test.ts has for the graph
// pasted into GraphDspPlugin.cpp.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOGUE, isFresh } from "./catalogue";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "modules");

/** Every file under modules/, as the generator keys them: forward slashes, relative to root. */
function onDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

describe("the seeded catalogue", () => {
  it("holds exactly what is on disk", () => {
    // Both directions matter. A file added and not regenerated is a module nobody's library
    // gets; a file removed and not regenerated is one everybody's library keeps forever.
    expect(Object.keys(CATALOGUE).sort()).toEqual(onDisk());
  });

  it("holds the same BYTES as the files it was generated from", () => {
    for (const [rel, text] of Object.entries(CATALOGUE))
      expect(
        readFileSync(join(root, ...rel.split("/")), "utf8"),
        `${rel} is stale — run \`npm run gen:catalogue --workspace @studio/dsp\``,
      ).toBe(text);
  });

  it("is laid out as a LIBRARY, so a key is a ref minus its namespace", () => {
    // This is the whole reason the folder was rearranged: `@st0/audio/utility/tempo` has to
    // land at `modules/audio/utility/tempo`, and the seed is a plain copy rather than a table
    // mapping one to the other. `scaffoldSet` names these four in every new set.
    for (const ref of [
      "audio/utility/crossfade",
      "audio/utility/tempo",
      "audio/filter/eq3",
      "audio/filter/sweep",
    ])
      expect(CATALOGUE[`${ref}/module.yaml`]).toBeTypeOf("string");
  });

  it("gives every module a module.yaml", () => {
    // A folder that holds only a `ui.yaml` is a panel for a module that does not exist — which
    // the loader reports against the project rather than against the library that shipped it.
    const folders = new Set(
      Object.keys(CATALOGUE).map((p) => p.split("/").slice(0, -1).join("/")),
    );
    for (const f of folders)
      expect(
        CATALOGUE[`${f}/module.yaml`],
        `${f} has no module.yaml`,
      ).toBeTypeOf("string");
  });

  it("calls a checkout fresh only when it has no modules/ at all", () => {
    expect(isFresh(join(here, "..", "..", "..", "no-such-folder"))).toBe(true);
    // This package is not a library, but it HAS a `modules/` — which is the only thing the
    // question looks at, and the point: a single module in there means hands off.
    expect(isFresh(join(here, ".."))).toBe(false);
  });
});
