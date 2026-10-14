// migrateStemLevels.ts — turn a SET's one-way stem cuts into the signed levels a knob can centre on.
//
//   npx tsx packages/song/scripts/migrateStemLevels.ts <projet.k7> [more…] [--write]
//
// `Cut` ran 0..1 and only removed. `Level` runs −1..1: left takes the instrument out, centre is the
// record as recorded, right adds more of it. So the VALUE is negated as the key is renamed — a set
// that had removed 60% of the drums still has, and does not suddenly have twice as many.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order survive.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STEMS, stemControl } from "@studio/song-schema/stems";
import { parseDocument, type YAMLMap } from "yaml";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };
const OLD = "Cut";
/** Spelled out and NOT `NEW`: a migration describes ONE step of a history, and that constant
 *  has moved on twice since — it is `Gain` now. Following it would make this rename skip two steps. */
const NEW = "Level";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateStemLevels <projet.k7> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

let seen = 0;
let changed = 0;

for (const dir of roots) {
  seen += 1;
  console.log(dir);

  const surfacePath = join(dir, "surfaces", "desk.yaml");
  if (!existsSync(surfacePath)) {
    console.error("  ! no surfaces/desk.yaml — this is not a set");
    continue;
  }
  const sdoc = parseDocument(readFileSync(surfacePath, "utf8"), OPTS);
  const mapping = sdoc.get("mapping") as YAMLMap | undefined;
  if (!mapping?.items?.length) {
    console.error("  ! that surface wires nothing");
    continue;
  }

  // Every deck the mapping names, read off its tempo line — the one control every deck has.
  const decks = mapping.items
    .map((i) => String((i.key as { value?: unknown })?.value ?? ""))
    .filter((k) => k.endsWith(".tempo"))
    .map((k) => k.split(".")[0]);

  const nodes: { path: string; module: string }[] = [];
  let touched = false;

  for (const deck of decks)
    for (const stem of STEMS) {
      const control = stemControl(deck, stem);
      const line = mapping.get(control) as YAMLMap | undefined;
      if (!line?.get) continue;
      if (line.get("param") !== OLD) continue;
      line.set("param", NEW);
      const module = String(line.get("module") ?? "");
      if (module)
        nodes.push({ path: join(dir, "nodes", `${module}.yaml`), module });
      touched = true;
    }

  if (!touched) {
    console.log("  = already on signed levels");
    continue;
  }

  // The NODE files, whose value changes meaning with its key: 0.6 removed becomes −0.6.
  const rewritten: { path: string; text: string; was: number; now: number }[] =
    [];
  for (const { path, module } of nodes) {
    if (!existsSync(path)) {
      console.error(
        `  ! no nodes/${module}.yaml — the mapping names a node that is not there`,
      );
      continue;
    }
    const ndoc = parseDocument(readFileSync(path, "utf8"), OPTS);
    const params = ndoc.get("params") as YAMLMap | undefined;
    if (!params?.has?.(OLD)) continue;
    const was = Number(params.get(OLD) ?? 0);
    const now = was === 0 ? 0 : -was; // −0 is not a value anyone wants to read in a file
    params.set(OLD, now);
    // Rename in place, so the comment above the key and the key's position both survive.
    const pair = params.items.find(
      (i) => String((i.key as { value?: unknown })?.value) === OLD,
    );
    if (pair) (pair.key as { value?: unknown }).value = NEW;
    rewritten.push({ path, text: ndoc.toString(OUT), was, now });
  }

  changed += 1;
  console.log(
    `  + ${nodes.length} mapping line(s) and ${rewritten.length} node(s): ${OLD} → ${NEW}` +
      (rewritten.some((r) => r.was !== 0)
        ? `, negating ${rewritten
            .filter((r) => r.was !== 0)
            .map((r) => `${r.was}→${r.now}`)
            .join(" ")}`
        : ""),
  );
  if (!write) {
    console.log("  (dry run — pass --write to save)");
    continue;
  }
  writeFileSync(surfacePath, sdoc.toString(OUT), "utf8");
  for (const r of rewritten) writeFileSync(r.path, r.text, "utf8");
  console.log(`  written: ${surfacePath}, ${rewritten.length} node(s)`);
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}. ` +
    "The `stemcut` module in the library must be the signed one (docs/sharedFolders.md).",
);
