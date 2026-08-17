// What compiling a song costs, at two sizes. See benchProject.ts for why the fixture is
// synthetic and parameterised, and docs/audit-perf-web.md for what these numbers are for.
//
// The project is written to disk ONCE, outside the measured body: what is being timed is the
// compile, not `writeFileSync`.

import { bench, describe } from "vitest";
import { BENCH_SIZES, writeBenchProject } from "./benchProject";
import { compileNodeProject } from "./nodeProject";

for (const [name, size] of Object.entries(BENCH_SIZES)) {
  const dir = writeBenchProject(size);
  describe(`compileNodeProject — ${name} (${size.lanes} lanes)`, () => {
    bench("compile", () => {
      compileNodeProject(dir);
    });
  });
}
