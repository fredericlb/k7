// Run a module's JS/TS DSP source and print the graph it describes, as JSON on stdout.
//
// Spawned as a child by readJsDspGraph (nodeProject.ts). It lives HERE, inside the workspace, so that its own
// `@lanes/dsp` import resolves — a song folder has no node_modules and never will. The module's file is
// imported by absolute URL and receives the builder as an argument, so it needs to import nothing at runtime:
// `import type { GraphBuilder }` is erased, and a song stays a song rather than becoming a package.

import { pathToFileURL } from "node:url";
import { graph } from "@lanes/dsp";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: dspRunner <module-source>\n");
  process.exit(2);
}
try {
  const m = await import(pathToFileURL(file).href);
  const d = m.default;
  if (d === undefined) throw new Error("no default export");
  // Either shape: a function taking the builder, or a graph object already built.
  process.stdout.write(
    JSON.stringify(typeof d === "function" ? graph(d) : d, null, 2),
  );
} catch (e) {
  process.stderr.write(String(e?.message ?? e));
  process.exit(1);
}
