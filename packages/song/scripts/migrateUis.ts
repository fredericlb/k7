// One-shot: move the `ui:` blocks still written inside module files out into the workspace's
// `_ui/` library, for one project and the shared `_modules` beside it. Re-runnable — a module
// with no `ui:` left is already migrated and is skipped.
//
//   npx tsx packages/song/scripts/migrateUis.ts <project> [project…]
//
// A script rather than a command: a one-shot repair for projects written against an older format
// is run once on a folder, not a verb sitting in every session's palette. See docs/uiLibrary.md.

import { statSync } from "node:fs";
import { migrateModuleUis } from "../src/uiMigrate";

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error("usage: migrateUis <project> [project…]");
  process.exit(2);
}

let moved = 0;
for (const root of roots) {
  if (!statSync(root, { throwIfNoEntry: false })) {
    console.error(`skipped ${root} — no such folder`);
    continue;
  }
  const r = migrateModuleUis(root);
  moved += r.moved.length;
  console.log(
    r.moved.length
      ? `${root}\n    ${r.moved.join("\n    ")}`
      : `${root} — nothing left inline`,
  );
  for (const e of r.errors) console.error(`    ! ${e}`);
}
console.log(`${moved} panel(s) moved`);
