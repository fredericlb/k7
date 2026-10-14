// migrateK7x.ts — convert every YAML file under the given folders to .k7x, each only when it reads back the same.
//
//   npx tsx packages/song/scripts/migrateK7x.ts <dir> [more dirs…] [--write] [--backup <dir>]
//
// Dry by default. With --write, a converted original goes to --backup (under its relative path) or,
// without one, is removed — a folder in git keeps it in its history. What does not convert stays YAML
// and is listed. See packages/song/docs/k7xFiles.md.

import { resolve } from "node:path";
import { migrateToK7x } from "../src/k7xMigrate";

const args = process.argv.slice(2);
const write = args.includes("--write");
const at = args.indexOf("--backup");
const backup = at >= 0 ? resolve(args[at + 1]) : null;
const roots = args.filter(
  (a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1),
);
if (!roots.length) {
  console.error(
    "usage: migrateK7x <dir> [more dirs…] [--write] [--backup <dir>]   (dry run without --write)",
  );
  process.exit(2);
}

let refused = 0;
for (const root of roots) {
  const r = migrateToK7x(resolve(root), {
    backup: backup && resolve(backup, root.replace(/[/\\]/g, "_")),
    dryRun: !write,
  });
  console.log(
    `${root}: ${r.converted.length} ${write ? "converted" : "would convert"}, ${r.shadowed.length} shadowed by a .k7x, ${r.refused.length} refused`,
  );
  for (const f of r.shadowed) console.log(`  shadowed  ${f}`);
  for (const f of r.refused) console.log(`  refused   ${f.file}: ${f.reason}`);
  refused += r.refused.length;
}
process.exit(refused ? 1 : 0);
