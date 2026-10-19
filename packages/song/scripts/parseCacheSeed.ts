// parseCacheSeed.ts — the bundle's own parse store: every module and panel of a library parsed ONCE, at
// bundle time, by the very parsers the bundle runs (it is bundled with them), so a first launch on a phone
// does not parse them in interpreted JavaScript. Keyed as parseStore.ts keys, by content.
// Usage: node parse-cache-seed.mjs <library folder> <out.json>. Run by apps/k7/backend/scripts/bundle.mjs.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseModule } from "@studio/song-schema/yaml/moduleFile";
import { parseUiFile } from "@studio/song-schema/yaml/uiFile";
import { parseKey } from "../src/yaml/parseStore";

const [root, out] = process.argv.slice(2);
if (!root || !out)
  throw new Error("usage: parse-cache-seed <library> <out.json>");

const entries: Record<string, unknown> = {};
let files = 0;
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith(".")) walk(path);
      continue;
    }
    if (!/\.k7x$/i.test(e.name)) continue;
    const raw = readFileSync(path, "utf8");
    // A panel is `ui.*`, everything else is read as a module — a guess only costs a miss, never a wrong answer.
    const kind = /^ui\./i.test(basename(path)) ? "ui" : "module";
    try {
      entries[parseKey(kind, path, raw)] =
        kind === "ui" ? parseUiFile(raw) : parseModule(raw);
      files++;
    } catch {
      /* unreadable: the runtime parses it and reports why */
    }
  }
};
walk(root);
writeFileSync(out, JSON.stringify({ code: "", entries }));
console.log(`parse cache: ${files} file(s) of ${root} parsed into ${out}`);
