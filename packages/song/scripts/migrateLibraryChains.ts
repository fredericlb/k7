// One-shot: rewrite a library's folder chains (`chains/<ref>/graph.yaml` + `nodes/`) as chain files
// `chains/<ref>.yaml`. Dry run unless `--write`; a chain it cannot carry over is reported and left
// alone. Every conversion is read back and compared before writing. docs/sharedFolders.md.
//
//   npx tsx packages/song/scripts/migrateLibraryChains.ts <library-folder> [more…] [--write]

import { basename, resolve } from "node:path";
import {
  applyConversion,
  convertFolderChain,
  folderChains,
} from "../src/libraryChainsMigrate";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => a !== "--write");
if (!roots.length) {
  console.error(
    "usage: migrateLibraryChains <library-folder> [more…] [--write]",
  );
  process.exit(2);
}
let failed = 0;
for (const root of roots.map((r) => resolve(r))) {
  const chains = folderChains(basename(root), root);
  console.log(`${root}: ${chains.length} folder chain(s)`);
  for (const c of chains) {
    try {
      const cv = convertFolderChain(c);
      if (write) applyConversion(cv);
      const moved = cv.presets.length ? `, ${cv.presets.length} preset(s)` : "";
      console.log(
        `  ${write ? "migrated" : "would migrate"} ${c.path}: ${cv.ids.map(([n]) => n).join(" → ")}${moved}`,
      );
      if (cv.note) console.log(`    note: ${cv.note}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${c.path}: ${(e as Error).message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
