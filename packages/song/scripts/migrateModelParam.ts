// migrateModelParam.ts — an amp's file param is `model:`, which takes a .nam or an RTNeural JSON (moduleTypes.md).
//
//   npx tsx packages/song/scripts/migrateModelParam.ts <dir> [more dirs…] [--write]
//
// Dry by default. A `nam:` key directly under `params:` becomes `model:`, and a widget's `bind: nam` becomes
// `bind: model`. Line edits rather than a YAML round trip, so comments and layout stay byte for byte.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateModelParam <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.endsWith(".yaml") || e.endsWith(".yml")) yield p;
  }
}

/** The file with its `params: nam:` keys and `bind: nam` widgets renamed, and how many of each. */
export function migrate(text: string): {
  text: string;
  keys: number;
  binds: number;
} {
  let keys = 0;
  let binds = 0;
  let paramsIndent: number | null = null;
  const lines = text.split("\n").map((line) => {
    const indent = line.length - line.trimStart().length;
    const body = line.trim();
    if (/^params:\s*(#.*)?$/.test(body)) {
      paramsIndent = indent;
      return line;
    }
    // A key at or left of `params:` closes it; a blank line or a comment does not.
    if (
      paramsIndent !== null &&
      body &&
      !body.startsWith("#") &&
      indent <= paramsIndent
    )
      paramsIndent = null;
    let out = line;
    if (
      paramsIndent !== null &&
      indent > paramsIndent &&
      /^nam\s*:/.test(body)
    ) {
      out = line.replace(/^(\s*)nam(\s*:)/, "$1model$2");
      keys++;
    }
    const rebound = out.replace(/\bbind:\s*nam\b/g, (m) =>
      m.replace("nam", "model"),
    );
    if (rebound !== out) binds++;
    return rebound;
  });
  return { text: lines.join("\n"), keys, binds };
}

let files = 0;
for (const root of roots)
  for (const file of walk(root)) {
    const before = readFileSync(file, "utf8");
    const { text, keys, binds } = migrate(before);
    if (text === before) continue;
    files++;
    console.log(
      `${write ? "wrote" : "would write"} ${file}: ${keys} param(s), ${binds} bind(s)`,
    );
    if (write) writeFileSync(file, text, "utf8");
  }
console.log(`${files} file(s)${write ? "" : " — dry run, pass --write"}`);
