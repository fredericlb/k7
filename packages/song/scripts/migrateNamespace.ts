// migrateNamespace.ts — rewrite the médiathèque's module level, `@mediatek/…` → `@st0/…`, in
// every YAML of a project, a workspace or the médiathèque itself. Nothing resolves the old
// spelling, so a file still carrying it names a module that does not exist.
// Why it is a text replace and not the yaml Document API: docs/moduleNamespaces.md.
//
//   npx tsx packages/song/scripts/migrateNamespace.ts <dir> [more dirs…] [--write]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_MEDIATEK_NS } from "../src/moduleTypes.ts";

const FROM = `@${LEGACY_MEDIATEK_NS}/`;
const TO = "@st0/";
// A library's own `modules/config.yaml` says which level it is. Nothing reads it back — the
// level comes from the folder's location — but a line that contradicts the loader is a lie
// somebody will act on, so it is rewritten too. Anchored, so it cannot match a ref.
const CONFIG_LINE = /^(namespace:\s*)["']?mediatek["']?\s*$/m;

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateNamespace <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** Every *.yaml under `dir`, skipping the places a project keeps things it did not author. */
function* yamlFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "_history")
      continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* yamlFiles(p);
    else if (/\.ya?ml$/i.test(name)) yield p;
  }
}

let files = 0;
let refs = 0;
for (const root of roots) {
  for (const file of yamlFiles(root)) {
    const before = readFileSync(file, "utf8");
    const hits = before.split(FROM).length - 1;
    const after = before.split(FROM).join(TO).replace(CONFIG_LINE, "$1st0");
    if (after === before) continue;
    files++;
    refs += hits;
    console.log(`${String(hits).padStart(4)}  ${file}`);
    if (write) writeFileSync(file, after, "utf8");
  }
}

console.log(
  `\n${refs} ref${refs === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` +
    (write ? " — written" : " — dry run, pass --write to save"),
);
