// migrateDocFields.ts — turn every `docs:`/`todos:` a project still carries into a `#` comment.
//
//   npx tsx packages/song/scripts/migrateDocFields.ts <dir> [more dirs…] [--write]
//
// Both fields are gone from the `.strict()` schemas (docs/docModules.md), so a file carrying one
// refuses to load — the prose is MOVED rather than deleted. Through the yaml Document API and
// never by rewriting text, so every other comment and the key order come back byte-identical.
// Dry by default.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateDocFields <dir> [more dirs…] [--write]   (dry run without --write)",
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

/** The prose of one file's two fields, as comment lines — or null when it carries neither. */
function proseOf(doc: ReturnType<typeof parseDocument>): string | null {
  const docs = doc.get("docs");
  const todos = doc.get("todos", true);
  const lines: string[] = [];
  if (typeof docs === "string" && docs.trim())
    lines.push(...docs.trim().split("\n"));
  const items = (todos as { toJSON?: () => unknown } | undefined)?.toJSON?.();
  if (Array.isArray(items)) {
    const kept = items.map(String).filter((s) => s.trim());
    if (kept.length) {
      if (lines.length) lines.push("");
      lines.push(`TODO: ${kept.join("; ")}.`);
    }
  }
  return lines.length ? lines.join("\n") : null;
}

let seen = 0;
let changed = 0;
for (const root of roots)
  for (const file of yamlFiles(root)) {
    seen++;
    let doc: ReturnType<typeof parseDocument>;
    let before: string;
    try {
      before = readFileSync(file, "utf8");
      doc = parseDocument(before, { version: "1.2" });
    } catch {
      continue; // not ours to fix; the loader will report it
    }
    if (doc.errors.length) continue;
    if (doc.get("docs") === undefined && doc.get("todos") === undefined)
      continue;

    const prose = proseOf(doc);
    doc.delete("docs");
    doc.delete("todos");
    // TRAILING, which is where `docs:` sat in every file that has one — so the prose does not
    // jump above a header comment it was written under. A file's own header is usually attached
    // to its first ITEM rather than to the document, so prepending would have interleaved the
    // two: the description first, then the header explaining the file. An empty result (a
    // `docs: ""` nobody wrote) simply drops the keys.
    if (prose)
      doc.comment = doc.comment
        ? `${doc.comment}\n${prose.replace(/^/gm, " ")}`
        : prose.replace(/^/gm, " ");

    const after = doc.toString({ lineWidth: 0 });
    if (after === before) continue;
    changed++;
    console.log(`${write ? "wrote" : "would write"}  ${file}`);
    if (write) writeFileSync(file, after, "utf8");
  }

console.log(
  `\n${changed} of ${seen} yaml file(s) ${write ? "migrated" : "would change"}.`,
);
if (!changed) console.log("nothing to do.");
