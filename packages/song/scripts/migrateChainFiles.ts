// One-shot: rewrite node projects (`graph.yaml` + `nodes/`) as chain projects (`chains/` + `tracks/`).
// Dry run unless `--write`; a project it cannot carry over is reported and left alone. docs/chainFiles.md.
//
//   npx tsx packages/song/scripts/migrateChainFiles.ts <project.st0> [more…] [--write]

import {
  migrateToChainFiles,
  migrationBlocker,
} from "../src/chainsMigrateFiles";

const args = process.argv.slice(2);
const write = args.includes("--write");
const dirs = args.filter((a) => a !== "--write");
if (!dirs.length) {
  console.error("usage: migrateChainFiles <project.st0> [more…] [--write]");
  process.exit(2);
}
let failed = 0;
for (const dir of dirs) {
  const why = migrationBlocker(dir);
  if (why) {
    console.log(`skip ${dir}: ${why}`);
    continue;
  }
  try {
    const r = migrateToChainFiles(dir, !write);
    console.log(
      `${write ? "migrated" : "would migrate"} ${dir}: ${r.chains.length} chains (${r.chains.join(", ")})`,
    );
    if (r.loose.length)
      console.log(`  loose, hidden unless placed: ${r.loose.join(", ")}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${dir}: ${(e as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
