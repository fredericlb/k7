// migrateToEngines.ts — repoint the uses of modules that became ENGINES of another module.
//
//   npx tsx packages/song/scripts/migrateToEngines.ts <map.json> <dir> [more dirs…] [--write]
//
// map.json is `{ "<old ref>": { "ref": "<module ref>", "engine": "<name>" } }`. Each file whose
// `extends:` is an old ref gets the new ref and `engine:`, and its params — its own and every
// alternative's — move under `engines.<name>.params`, since a module with engines reads no other
// (packages/song/docs/engines.md). Through the yaml Document API, so comments survive. Dry by default.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, type Document, Pair, parseDocument, Scalar } from "yaml";

const args = process.argv.slice(2);
const write = args.includes("--write");
const [mapFile, ...roots] = args.filter((a) => !a.startsWith("--"));
if (!mapFile || !roots.length) {
  console.error(
    "usage: migrateToEngines <map.json> <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}
const MAP = JSON.parse(readFileSync(mapFile, "utf8")) as Record<
  string,
  { ref: string; engine: string }
>;

/** Every *.yaml under `dir`, skipping what a project did not author and what it threw away. */
function* yamlFiles(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (["node_modules", ".git", "_history", "_recycle_bin"].includes(name))
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

/** Move `params` of one map (the file, or one alternative) under `engines.<engine>.params`. */
function moveParams(
  doc: Document,
  at: (string | number)[],
  engine: string,
): boolean {
  const params = doc.getIn([...at, "params"]);
  if (!isMap(params) || !params.items.length) return false;
  for (const item of params.items)
    doc.setIn(
      [...at, "engines", engine, "params", String((item.key as Scalar).value)],
      item.value,
    );
  doc.deleteIn([...at, "params"]);
  const moved = doc.getIn([...at, "engines"]);
  if (isMap(moved)) moved.flow = false;
  return true;
}

let changed = 0;
for (const root of roots)
  for (const file of yamlFiles(root)) {
    const text = readFileSync(file, "utf8");
    const doc = parseDocument(text, { version: "1.2" });
    const old = doc.get("extends");
    const to = typeof old === "string" ? MAP[old] : undefined;
    if (!to || !isMap(doc.contents)) continue;

    doc.set("extends", to.ref);
    // `engine:` right after `extends:`, which is where a reader looks for what the node runs.
    const items = doc.contents.items;
    const at = items.findIndex((p) => (p.key as Scalar)?.value === "extends");
    const existing = items.findIndex(
      (p) => (p.key as Scalar)?.value === "engine",
    );
    if (existing >= 0) items.splice(existing, 1);
    items.splice(
      at + 1,
      0,
      new Pair(new Scalar("engine"), new Scalar(to.engine)),
    );

    const moved = [moveParams(doc, [], to.engine)];
    const alts = doc.get("alternatives");
    if (isSeq(alts))
      alts.items.forEach((_, i) => {
        moved.push(moveParams(doc, ["alternatives", i], to.engine));
      });

    // The scaffold's header names the module in a comment; it should name the one now used.
    const out = doc
      .toString({ lineWidth: 0 })
      .split(`"${old}"`)
      .join(`"${to.ref}"`);
    changed++;
    console.log(
      `${write ? "wrote" : "would write"} ${file}: ${old} → ${to.ref} [${to.engine}]` +
        (moved.some(Boolean) ? ", params moved under the engine" : ""),
    );
    if (write) writeFileSync(file, out, "utf8");
  }
console.log(
  `${changed} file(s)${write ? "" : " — dry run, pass --write to apply"}`,
);
