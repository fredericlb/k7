// migrateToEngines.ts — repoint the uses of modules that became ENGINES of another module.
//
//   npx tsx packages/song/scripts/migrateToEngines.ts <map.json> <dir> [more dirs…] [--write]
//
// map.json is `{ "<old ref>": { "ref": "<module ref>", "engine": "<name>" } }`. A file, or an
// alternative naming its own module, whose `extends:` is an old ref gets the new ref and `engine:`,
// and its params move under `engines.<name>.params` — a module with engines reads no other
// (packages/song/docs/engines.md). Through the yaml Document API, so comments survive. Dry by default.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Document, isMap, isSeq, Pair, parseDocument, Scalar } from "yaml";

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

/** Repoint the map at `at` (the file, or one alternative) if its `extends:` is an old ref; what it was, or null. */
function repoint(doc: Document, at: (string | number)[]): string | null {
  const node = at.length ? doc.getIn(at) : doc.contents;
  if (!isMap(node)) return null;
  const old = node.get("extends");
  const to = typeof old === "string" ? MAP[old] : undefined;
  if (!to) return null;
  node.set("extends", to.ref);
  // `engine:` right after `extends:`, which is where a reader looks for what the node runs.
  const items = node.items;
  const existing = items.findIndex(
    (p) => (p.key as Scalar)?.value === "engine",
  );
  if (existing >= 0) items.splice(existing, 1);
  const ext = items.findIndex((p) => (p.key as Scalar)?.value === "extends");
  items.splice(
    ext + 1,
    0,
    new Pair(new Scalar("engine"), new Scalar(to.engine)),
  );
  moveParams(doc, at, to.engine);
  return old as string;
}

/** Does alternative `i` name its OWN module? Then its params are that module's, not this one's. */
function swapsModule(doc: Document, i: number): boolean {
  const alt = doc.getIn(["alternatives", i]);
  return isMap(alt) && alt.has("extends");
}

let changed = 0;
for (const root of roots)
  for (const file of yamlFiles(root)) {
    const text = readFileSync(file, "utf8");
    const doc = parseDocument(text, { version: "1.2" });
    const done: string[] = [];
    const own = repoint(doc, []);
    if (own) {
      done.push(`${own} → ${MAP[own].ref} [${MAP[own].engine}]`);
      // A file repointed whole: its alternatives' params belong to the same engine.
      const alts = doc.get("alternatives");
      if (isSeq(alts))
        alts.items.forEach((_, i) => {
          if (!swapsModule(doc, i))
            moveParams(doc, ["alternatives", i], MAP[own].engine);
        });
    }
    // …and an alternative naming ANOTHER module is repointed on its own (packages/song/docs/alternatives.md).
    const alts = doc.get("alternatives");
    if (isSeq(alts))
      alts.items.forEach((_, i) => {
        const was = repoint(doc, ["alternatives", i]);
        if (was)
          done.push(
            `alternative ${i + 2}: ${was} → ${MAP[was].ref} [${MAP[was].engine}]`,
          );
      });
    if (!done.length) continue;

    let out = doc.toString({ lineWidth: 0 });
    // The scaffold's header names the module in a comment; it should name the one now used.
    for (const [old, to] of Object.entries(MAP))
      out = out.split(`"${old}"`).join(`"${to.ref}"`);
    changed++;
    console.log(
      `${write ? "wrote" : "would write"} ${file}: ${done.join("; ")}`,
    );
    if (write) writeFileSync(file, out, "utf8");
  }
console.log(
  `${changed} file(s)${write ? "" : " — dry run, pass --write to apply"}`,
);
