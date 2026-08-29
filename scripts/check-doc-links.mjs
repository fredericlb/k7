// check-doc-links.mjs — refuse a documentation page that names a source file which is not there.
//
// The method of this repo is that the WHY lives in the prose: a comment points at a `docs/` page,
// and the page points back at the code it is about. A pointer to a file that has been renamed or
// deleted sends the reader into a wall, and nothing else notices.
//
// It reads what git tracks AND what it merely knows about, and only paths that look like OUR tree.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/** What counts as "a path into this repo" — the four TOP folders only (../docs/lints.md). */
const REF =
  /(?<![\w.-])(?:\.\.\/)*(?:packages|apps|engine|commons)\/[\w./-]*\.\w{1,5}\b/g;

/** Paths a page may name although this checkout has not got them — kept short (../docs/lints.md). */
const ALLOW = [
  // Written relative to engine/moteur, whose own docs are the only ones that do it.
  /^engine\/(?!moteur\/)/,
  // The commons submodule, which a shallow checkout may not have.
  /^packages\/(http|oidc|pkg|a)\//,
];

/** PIERRES TOMBALES — a page names a file precisely because it is gone (../docs/lints.md). */
const TOMBSTONES = new Set([]);

// `--others` too, or a page is unchecked until the day it is committed — which is the day it is
// written, and the day its references are most likely to be wrong. `--exclude-standard` keeps the
// ignored tree out. Found by planting a dead reference in a new page and watching this pass.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", "*.md"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\n")
  .filter(Boolean)
  // The submodule brings its own docs and its own truth about them.
  .filter((f) => !f.startsWith("commons/"));

const dead = [];
let cited = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  for (const [i, line] of lines.entries()) {
    for (const hit of line.matchAll(REF)) {
      const ref = hit[0];
      cited += 1;
      if (TOMBSTONES.has(ref) || ALLOW.some((r) => r.test(ref))) continue;
      // From the repo root first, then relative to the page (../docs/lints.md).
      if (existsSync(ref) || existsSync(normalize(join(dirname(file), ref))))
        continue;
      dead.push({ file, line: i + 1, ref });
    }
  }
}

if (dead.length) {
  console.error(
    `${dead.length} documentation reference(s) name a file that is not here:\n`,
  );
  for (const d of dead) console.error(`  ${d.file}:${d.line} — ${d.ref}`);
  console.error(
    "\nRename it, or say what took its place. A page that points at nothing is worse than no page:\n" +
      "it is read as current.",
  );
  process.exit(1);
}

console.log(
  `${cited} source reference(s) in ${files.length} documentation pages, all present`,
);
