// migrateSetPlatter.ts — give a SET the platters it never declared.
//
//   npx tsx packages/song/scripts/migrateSetPlatter.ts <projet.k7> [more…] [--write]
//
// Until now the desk INJECTED a `studio_turntable` plugin into the document on its way out, so a
// set's source was drawn by nothing: the chains view started at the tempo. One platter per lane
// that plays a file — the record, and one per stem. See docs/platter-node-plan.md.
//
// THIS ONE IS NOT OPTIONAL. The desk no longer invents the plugin; it patches the record onto one
// the compiler emitted. A set left un-migrated has nothing to patch, and plays silence.
//
// The nodes it writes name `@meta/audio/turntable`, which ships with k7 (docs/metaModules.md):
// no library has to hold it first.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order come back
// byte-identical.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  deckPlatter,
  STEMS,
  stemLane,
  stemPlatter,
} from "@studio/song-schema/stems";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { platterNodeFiles } from "../src/scaffoldSet.ts";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps a list on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetPlatter <projet.k7> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** The one `turntables` surface of a project, or null. */
function surfaceOf(dir: string): { path: string; text: string } | null {
  const folder = join(dir, "surfaces");
  if (!existsSync(folder)) return null;
  for (const name of ["desk.yaml", "desk.yml"]) {
    const path = join(folder, name);
    if (existsSync(path)) return { path, text: readFileSync(path, "utf8") };
  }
  return null;
}

/** Where `name` sits among the `modules:` entries, or -1. */
const lineOf = (modules: YAMLMap, name: string): number =>
  modules.items.findIndex(
    (i) => String((i as { key?: { value?: unknown } }).key?.value) === name,
  );

/** The decks a surface declares, by the control ids its mapping is keyed on. */
function decksOf(mapping: YAMLMap): string[] {
  const out: string[] = [];
  for (const item of mapping.items) {
    const key = String(
      (item as { key?: { value?: unknown } }).key?.value ?? "",
    );
    const [id, control] = key.split(".");
    // `tempo` and not `filter`: every deck has one, and it is what the deck's own LANE runs into.
    if (id && control === "tempo" && !out.includes(id)) out.push(id);
  }
  return out;
}

let seen = 0;
let changed = 0;

for (const dir of roots) {
  seen += 1;
  console.log(dir);

  const surface = surfaceOf(dir);
  if (!surface) {
    console.error("  ! no surfaces/desk.yaml — this is not a set");
    continue;
  }
  const sdoc = parseDocument(surface.text, OPTS);
  if (sdoc.get("type") !== "turntables") {
    console.error("  ! surfaces/desk.yaml is not a `turntables` surface");
    continue;
  }
  const mapping = sdoc.get("mapping") as YAMLMap | undefined;
  if (!mapping?.items) {
    console.error("  ! surfaces/desk.yaml has no `mapping:`");
    continue;
  }
  const graphPath = join(dir, GRAPH_FILE);
  const gdoc = parseDocument(readFileSync(graphPath, "utf8"), OPTS);
  const modules = gdoc.get("modules") as YAMLMap | undefined;
  if (!modules?.items) {
    console.error(`  ! ${GRAPH_FILE} has no \`modules:\``);
    continue;
  }

  const files: Record<string, string> = {};
  let touched = false;

  for (const deck of decksOf(mapping)) {
    // Reported per deck, since a half-migrated set is a real state after an interrupted run.
    if (modules.has(deckPlatter(deck))) {
      console.log(`  = ${deck}: already has ${deckPlatter(deck)}`);
      continue;
    }

    /** Splice `<lane>: [ <platter> ]` in front of the lane, and re-point the lane at it. */
    const insert = (lane: string, platter: string): boolean => {
      const at = lineOf(modules, lane);
      if (at < 0) {
        console.error(`  ! ${deck}: no \`${lane}\` in ${GRAPH_FILE} — skipped`);
        return false;
      }
      // What the lane fed BEFORE becomes what the platter feeds; the lane now feeds the platter.
      const was = modules.get(lane) as YAMLSeq | undefined;
      const seq = gdoc.createNode([...(was?.items ?? [])]) as YAMLSeq;
      seq.flow = true;
      const only = gdoc.createNode([platter]) as YAMLSeq;
      only.flow = true;
      modules.set(lane, only);
      modules.items.splice(at + 1, 0, gdoc.createPair(platter, seq));
      return true;
    };

    if (!insert(deck, deckPlatter(deck))) continue;
    for (const stem of STEMS)
      insert(stemLane(deck, stem), stemPlatter(deck, stem));

    Object.assign(files, platterNodeFiles([deck]));
    touched = true;
    console.log(
      `  + ${deck}: ${deckPlatter(deck)} et ${STEMS.length} plateaux de stem`,
    );
  }

  if (!touched) continue;
  changed += 1;

  if (!write) {
    console.log("  (dry run — pass --write to save)");
    continue;
  }
  writeFileSync(graphPath, gdoc.toString(OUT), "utf8");
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  console.log(`  written: ${GRAPH_FILE}, ${Object.keys(files).length} node(s)`);
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}.`,
);
