// What building the chains view costs, at two sizes.
//
// This is the path the repo already has a number for — "~280 ms on a real one", in the comment
// above `Workspace.graphDoc`'s memo — and the one that number could never be re-measured against.
// It is the whole reason the memo on the revision token exists, so it is the first thing any work
// on that memo should be able to show a before and after for.
//
// `buildGraphDoc` is called WITHOUT clip extents here, deliberately: those come from the compiled
// project, which `nodeProject.bench.ts` times on its own. Two costs, two benches.

import { BENCH_SIZES, writeBenchProject } from "@studio/song/testSupport";
import { bench, describe } from "vitest";
import { buildGraphDoc } from "./graphDoc.ts";

for (const [name, size] of Object.entries(BENCH_SIZES)) {
  const dir = writeBenchProject(size);
  describe(`buildGraphDoc — ${name} (${size.lanes} lanes)`, () => {
    bench("build", () => {
      buildGraphDoc(dir);
    });
  });
}
