// migrateStemGain.ts — take the `stemcut` module out of a set: a stem's level moves onto the
// PLATTER that reads it.
//
//   npx tsx packages/song/scripts/migrateStemGain.ts <projet.k7> [more…] [--write]
//
// `stemcut` compiled to `gain(Level)`, one multiply, sitting immediately after a node that already
// had a linear `Gain` over the same 0..2 with the same rest at 1. Two gains in series. See
// packages/song-schema/docs/stems.md for why the module's own reason to exist expired.
//
// It needs the PLATTERS to be there — run migrateSetPlatter first on anything older.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order come back
// byte-identical.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  STEM_PARAM,
  STEMS,
  stemControl,
  stemCut,
  stemPlatter,
} from "@studio/song-schema/stems";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseDocument, type YAMLMap, type YAMLSeq } from "yaml";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps a list on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

/** What the cut's param used to be called. Only ever read here, to carry its VALUE across. */
const OLD_PARAM = "Level";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateStemGain <projet.k7> [more…] [--write]   (dry run without --write)",
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

/** The decks a surface declares, by the control ids its mapping is keyed on. */
function decksOf(mapping: YAMLMap): string[] {
  const out: string[] = [];
  for (const item of mapping.items) {
    const key = String(
      (item as { key?: { value?: unknown } }).key?.value ?? "",
    );
    const [id, control] = key.split(".");
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

  const dead: string[] = [];
  let rebound = 0;
  let touched = false;

  for (const deck of decksOf(mapping)) {
    for (const stem of STEMS) {
      const cut = stemCut(deck, stem);
      const platter = stemPlatter(deck, stem);
      const bound = mapping.get(stemControl(deck, stem)) as YAMLMap | undefined;
      // Keyed on the BINDING as well as the graph, because they are two files: a run that dies
      // between the two writes leaves a set whose knob still names a node nothing declares.
      const namesCut = String(bound?.get?.("module") ?? "") === cut;
      if (!modules.has(cut) && !namesCut) continue;
      if (!modules.has(platter)) {
        console.error(
          `  ! ${deck}/${stem}: no \`${platter}\` — run migrateSetPlatter first, skipped`,
        );
        continue;
      }

      // The cut's LEVEL is carried onto the platter: somebody may have left a part turned down.
      const node = join(dir, "nodes", `${cut}.yaml`);
      let level: unknown;
      if (existsSync(node)) {
        const cdoc = parseDocument(readFileSync(node, "utf8"), OPTS);
        level = (cdoc.get("params") as YAMLMap | undefined)?.get(OLD_PARAM);
      }

      // What the cut fed becomes what the platter feeds, and the cut leaves the graph.
      if (modules.has(cut)) {
        const onward = modules.get(cut) as YAMLSeq | undefined;
        const seq = gdoc.createNode([...(onward?.items ?? [])]) as YAMLSeq;
        seq.flow = true;
        modules.set(platter, seq);
        modules.delete(cut);
        dead.push(cut);
      }

      // …and the node file with it, once its one number has been moved.
      const pnode = join(dir, "nodes", `${platter}.yaml`);
      if (level !== undefined && level !== null && existsSync(pnode)) {
        const pdoc = parseDocument(readFileSync(pnode, "utf8"), OPTS);
        let params = pdoc.get("params") as YAMLMap | undefined;
        if (!params) {
          pdoc.set("params", pdoc.createNode({}));
          params = pdoc.get("params") as YAMLMap;
        }
        params.set(STEM_PARAM, level);
        if (write) writeFileSync(pnode, pdoc.toString(OUT), "utf8");
      }

      // The BINDING last, so a run that dies halfway leaves a graph nothing points into.
      // `flow`, or the eight one-liners come back as blocks and the diff is 24 lines of nothing.
      const bind = sdoc.createNode({
        module: platter,
        param: STEM_PARAM,
      }) as YAMLMap;
      bind.flow = true;
      mapping.set(stemControl(deck, stem), bind);
      if (namesCut) rebound += 1;
      touched = true;
    }
  }

  // A deleted node's PLACE outlives it otherwise: `positions:` is keyed by node name, and the
  // chains view would carry eight coordinates for nodes nothing declares.
  const positions = gdoc.get("positions") as YAMLMap | undefined;
  let placed = 0;
  if (positions?.items)
    for (const cut of dead)
      if (positions.has(cut)) {
        positions.delete(cut);
        placed += 1;
      }

  if (!touched) {
    console.log("  = no `cut` nodes — already on the platter's gain");
    continue;
  }
  if (placed)
    console.log(`  - ${placed} orphaned position(s) in \`positions:\``);
  changed += 1;
  // Reported apart: the graph and the surface are two files, so a set can be half done.
  if (dead.length)
    console.log(
      `  - ${dead.length} cut(s) out of the graph: ${dead.join(", ")}`,
    );
  if (rebound)
    console.log(
      `  + ${rebound} knob(s) moved onto their platter's ${STEM_PARAM}`,
    );

  if (!write) {
    console.log("  (dry run — pass --write to save)");
    continue;
  }
  writeFileSync(graphPath, gdoc.toString(OUT), "utf8");
  writeFileSync(surface.path, sdoc.toString(OUT), "utf8");
  for (const cut of dead)
    rmSync(join(dir, "nodes", `${cut}.yaml`), { force: true });
  console.log(
    `  written: ${GRAPH_FILE}, ${surface.path}, ${dead.length} node(s) removed`,
  );
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}. ` +
    "`@k7-core/audio/separation/stemcut` can then be dropped from the account's library — nothing " +
    "names it any more (packages/song-schema/docs/stems.md).",
);
