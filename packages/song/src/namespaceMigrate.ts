// namespaceMigrate.ts — rewrite the default library's old module levels, `@mediatek/…` and `@st0/…` →
// `@k7-core/…`, the modules k7-core renamed (`st0-rack`, `st0-4osc`), and the `st0:` pin of a
// `_library-pins.yaml`, in every YAML and .k7x under a folder. Nothing resolves the old spellings, so a file
// still carrying one names a module that does not exist. Idempotent: a folder done already changes nothing.
// Why it is a text replace and not the yaml Document API: docs/moduleNamespaces.md.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isDocFile } from "@studio/song-schema/docExt";
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
// The modules the library itself renamed with it; bounded, so a longer name sharing the start is left alone.
const RENAMED = new RegExp(
  `@${DEFAULT_LIBRARY}/instruments/st0-(rack|4osc)(?![A-Za-z0-9-])`,
  "g",
);

/** `text` with every old spelling rewritten, and how many refs that was. */
export function migrateNamespaceText(
  file: string,
  text: string,
): { after: string; hits: number } {
  let after = text;
  let hits = 0;
  for (const from of FROM) {
    hits += after.split(from).length - 1;
    after = after.split(from).join(TO);
  }
  after = after.replace(RENAMED, (_m, name: string) => {
    hits++;
    return `@${DEFAULT_LIBRARY}/instruments/k7-${name}`;
  });
  after = after.replace(CONFIG_LINE, `$1${DEFAULT_LIBRARY}`);
  if (basename(file) === LIBRARY_PINS_FILE && PIN_LINE.test(after)) {
    after = after.replace(PIN_LINE, `${DEFAULT_LIBRARY}:`);
    hits++;
  }
  return { after, hits };
}

/** Every *.yaml and *.k7x under `dir`, skipping what a project did not author and what is hidden (a backup, sync state). */
function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules" || name === "_history")
      continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* sourceFiles(p);
    else if (isDocFile(name)) yield p;
  }
}

/** Rewrite every file under `dir` that still says an old spelling; dry unless `write`. Answers each file changed. */
export function migrateNamespaceIn(
  dir: string,
  write: boolean,
): { file: string; hits: number }[] {
  const out: { file: string; hits: number }[] = [];
  for (const file of sourceFiles(dir)) {
    const before = readFileSync(file, "utf8");
    const { after, hits } = migrateNamespaceText(file, before);
    if (after === before) continue;
    out.push({ file, hits });
    if (write) writeFileSync(file, after, "utf8");
  }
  return out;
}
