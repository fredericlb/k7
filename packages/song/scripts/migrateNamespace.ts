// migrateNamespace.ts — rewrite the default library's old module levels, `@mediatek/…` and `@st0/…` →
// `@k7-core/…`, the modules k7-core renamed, and the `st0` pin of `_library-pins.k7x`, in every .k7x of a
// project, a workspace or a library, a legacy pins or manifest YAML upgraded on the way (src/namespaceMigrate.ts).
// A file still carrying an old spelling names a module that does not exist. Why a text replace: docs/moduleNamespaces.md.
//
//   npx tsx packages/song/scripts/migrateNamespace.ts <dir> [more dirs…] [--write]

import { migrateNamespaceIn } from "../src/namespaceMigrate";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateNamespace <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

let files = 0;
let refs = 0;
for (const root of roots)
  for (const { file, hits } of migrateNamespaceIn(root, write)) {
    files++;
    refs += hits;
    console.log(`${String(hits).padStart(4)}  ${file}`);
  }

console.log(
  `\n${refs} ref${refs === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` +
    (write ? " — written" : " — dry run, pass --write to save"),
);
