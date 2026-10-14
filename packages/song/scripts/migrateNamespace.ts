// migrateNamespace.ts — rewrite the default library's old module levels, `@mediatek/…` and
// `@st0/…` → `@k7-core/…`, in every YAML and .k7x of a project, a workspace or the médiathèque,
// and the `st0:` pin of a `_library-pins.yaml`. Nothing resolves the old spellings, so a file still
// carrying one names a module that does not exist.
// Why it is a text replace and not the yaml Document API: docs/moduleNamespaces.md.
//
//   npx tsx packages/song/scripts/migrateNamespace.ts <dir> [more dirs…] [--write]

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { LIBRARY_PINS_FILE } from "@studio/song-schema/libraryVersions";
import {
  DEFAULT_LIBRARY,
  LEGACY_DEFAULT_LIBRARY,
  LEGACY_MEDIATEK_NS,
} from "@studio/song-schema/moduleTypes";

const FROM = [`@${LEGACY_MEDIATEK_NS}/`, `@${LEGACY_DEFAULT_LIBRARY}/`];
const TO = `@${DEFAULT_LIBRARY}/`;
// Nothing reads `config.yaml` back, but a line contradicting the loader is a lie, so it is rewritten.
const CONFIG_LINE = /^(namespace:\s*)["']?(mediatek|st0)["']?\s*$/m;
// A pin is keyed by the library's name, so the old name pins a library that no longer exists.
const PIN_LINE = new RegExp(`^${LEGACY_DEFAULT_LIBRARY}:`, "m");

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateNamespace <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** Every *.yaml and *.k7x under `dir`, skipping the places a project keeps things it did not author. */
function* sourceFiles(dir: string): Generator<string> {
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
    if (st.isDirectory()) yield* sourceFiles(p);
    else if (/\.(ya?ml|k7x)$/i.test(name)) yield p;
  }
}

/** `text` with every old level rewritten, and how many refs that was. */
function migrate(file: string, text: string): { after: string; hits: number } {
  let after = text;
  let hits = 0;
  for (const from of FROM) {
    hits += after.split(from).length - 1;
    after = after.split(from).join(TO);
  }
  after = after.replace(CONFIG_LINE, `$1${DEFAULT_LIBRARY}`);
  if (basename(file) === LIBRARY_PINS_FILE && PIN_LINE.test(after)) {
    after = after.replace(PIN_LINE, `${DEFAULT_LIBRARY}:`);
    hits++;
  }
  return { after, hits };
}

let files = 0;
let refs = 0;
for (const root of roots) {
  for (const file of sourceFiles(root)) {
    const before = readFileSync(file, "utf8");
    const { after, hits } = migrate(file, before);
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
