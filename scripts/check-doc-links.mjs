// check-doc-links.mjs — refuse a documentation page that names a source file which is not there.
//
// The method of this repo is that the WHY lives in the prose: a comment points at a `docs/` page,
// and the page points back at the code it is about. A pointer to a file that has been renamed or
// deleted sends the reader into a wall, and nothing else notices — twenty-two of them had built
// up, still naming `apps/m9/…` two apps after the desk moved into st0.
//
// It reads only what git tracks, and only paths that look like OUR tree.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

/**
 * What counts as "a path into this repo".
 *
 * Anchored on the four TOP folders, and deliberately not on `docs/` or `scripts/`. Those two are
 * written relative to the zone a page is talking about — the root AGENTS.md says `docs/picture.md`
 * meaning st0's, and moteur's protocol.md says `scripts/two-sessions.ts` meaning its own — so a
 * check anchored on them would report a hundred sentences that are perfectly clear to a reader.
 *
 * The lookbehind is what keeps `[stems.md](../../ui-turntables/docs/stems.md)` from being read as
 * a reference to `docs/stems.md`: a match may open on `../`, never in the middle of a path.
 */
const REF =
  /(?<![\w.-])(?:\.\.\/)*(?:packages|apps|engine|commons)\/[\w./-]*\.\w{1,5}\b/g;

/**
 * Paths a page may legitimately name although this checkout has not got them.
 *
 * Two kinds, and both are real: a page inside `engine/moteur` writes `engine/EditBuilder.cpp`
 * relative to its own app, and a page may name a file of `@frediverse/*`, which is the commons
 * submodule and may not be checked out. Kept short and explained — a growing list here is the
 * check going soft.
 */
const ALLOW = [
  // Written relative to engine/moteur, whose own docs are the only ones that do it.
  /^engine\/(?!moteur\/|capot\/)/,
  // The commons submodule, which a shallow checkout may not have.
  /^packages\/(http|oidc|pkg|a)\//,
];

/**
 * PIERRES TOMBALES — a page names a file precisely because it is gone.
 *
 * This repo records what it removed and why, which is the opposite of a broken link: the reader
 * is not being sent anywhere, they are being told what used to be there. Refusing these would
 * make the check fight the method it exists to protect.
 *
 * Listed one by one rather than detected, because "the sentence around it says it went" is not
 * something a regex can be trusted with — and because a list somebody has to add to is a moment
 * to ask whether the page is recording a removal or has simply gone stale.
 */
const TOMBSTONES = new Set([
  // apps/k7/docs/audio.md — « Le miroir de la médiathèque a été retiré ».
  "apps/pl8/backend/src/mirror/k7.ts",
  // docs/constat.md — under « Ce qui a été supprimé ».
  "packages/ui-module-builder/src/libraryStore.ts",
  // docs/inventaire.md — names them to say that docs/audit-moteur.md is stale about them.
  "apps/m9/frontend/src/useEngine.ts",
  "apps/m9/frontend/src/Gate.tsx",
  // docs/rename-test-plan.md — a HISTORICAL page, kept for its method (see the root AGENTS.md).
  "apps/obscura/backend/src/render.ts",
  // docs/constat.md — the draft probe it reported, deleted since; the page says so.
  "packages/engine-client/frame.mjs",
  // docs/inventaire.md — one half of a duplication, resolved by the whole package going.
  "packages/recorder/src/detect.ts",
]);

const files = execFileSync("git", ["ls-files", "--", "*.md"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
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
      // From the repo root first — how nearly every page writes one — then relative to the page,
      // which is how a link like `../../packages/song/src/x.ts` resolves.
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
