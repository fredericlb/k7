// The build step: run the JS, write the JSON a module's `dsp:` points at. This is the whole "authoring in JS"
// story — the description is generated and COMMITTED, so it stays reviewable and the compiler stays synchronous.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { autoWah } from "./autowah";
import { crossfade } from "./crossfade";
import { echo } from "./echo";
import { fade } from "./fade";
import { flanger } from "./flanger";
import { normalize } from "./normalize";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "graphs");
mkdirSync(out, { recursive: true });
for (const [name, g] of [
  ["autowah", autoWah()],
  ["echo", echo()],
  ["flanger", flanger()],
  ["crossfade", crossfade()],
  ["fade", fade()],
  ["normalize", normalize()],
] as const) {
  const file = join(out, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(g, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${file}  (${g.params.length} params, ${g.nodes.length} nodes)`,
  );
}
