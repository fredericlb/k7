// vendor.ts — refreshes texts/ for the hand-listed components that carry a `vendor` list, from the
// licence files CMake fetched into an engine build's `_deps`. Run after bumping a pinned dependency:
//   npx tsx apps/k7/frontend/notices/vendor.ts [checkout whose engine builds to read]
// It needs a configured engine build; nothing at build or test time runs it (../docs/about.md).

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentsFile } from "./collect.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../../..");
/** A worktree has no engine build of its own, so the builds may be read from another checkout. */
const builds = process.argv[2] ?? root;

/** A standard licence's opening line: from there on the file is that text, which the page already carries. */
const STANDARD_STARTS: [RegExp, string][] = [
  [/^\s*GNU LESSER GENERAL PUBLIC LICENSE\s*$/m, "LGPL-2.1"],
  [/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s*$/m, "AGPL-3.0"],
  [/^\s*GNU GENERAL PUBLIC LICENSE\s*$/m, "GPL-3.0"],
  [/^\s*Mozilla Public License,? [Vv]ersion 2\.0\s*$/m, "MPL-2.0"],
  [/^\s*Apache License\s*$/m, "Apache-2.0"],
];

/** `runtime:` and `supervisor:` read the first engine build that has `_deps`; `repo:` reads the tree. */
function locate(spec: string): string {
  const [kind, path] = spec.split(/:(.*)/s) as [string, string];
  if (kind === "repo") return join(root, path);
  const engine = join(
    builds,
    "engine",
    kind === "runtime" ? "k7-runtime" : "k7-supervisor",
    "build",
  );
  const presets = existsSync(engine) ? readdirSync(engine) : [];
  const build = presets.find((b) => existsSync(join(engine, b, "_deps", path)));
  if (!build) throw new Error(`no engine build holds ${spec}`);
  return join(engine, build, "_deps", path);
}

function read(spec: string): string {
  const [file = "", range] = spec.split("#L");
  const text = readFileSync(locate(file), "utf8");
  if (!range) return text.trim();
  const [from = 1, to] = range.replace(/L/g, "").split("-").map(Number);
  return text
    .split("\n")
    .slice(from - 1, to)
    .join("\n")
    .trim();
}

/** The file's own notice, with a standard text it embeds replaced by a pointer to the one stored copy. */
function trimStandard(text: string): string {
  for (const [start, id] of STANDARD_STARTS) {
    const at = text.search(start);
    // Only a file that IS the standard after a short header: a notices file mentions them deep inside.
    if (at < 0 || at > 3000) continue;
    const head = text.slice(0, at).trim();
    return `${head}${head ? "\n\n" : ""}[The full text of ${id} is listed under the licences.]`;
  }
  return text;
}

const file = JSON.parse(
  readFileSync(join(here, "components.json"), "utf8"),
) as ComponentsFile;
for (const c of file.components) {
  if (!c.vendor || !c.text) continue;
  const parts = c.vendor.map((spec) => {
    const label = spec.replace(/^\w+:/, "").replace(/#L.*$/, "");
    return `----- ${label} -----\n\n${trimStandard(read(spec))}`;
  });
  writeFileSync(join(here, "texts", c.text), `${parts.join("\n\n")}\n`);
  console.log(`· ${c.text}`);
}
