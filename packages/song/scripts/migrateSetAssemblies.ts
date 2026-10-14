// migrateSetAssemblies.ts — draw an existing SET's decks as boxes.
//
//   npx tsx packages/song/scripts/migrateSetAssemblies.ts <projet.k7> [more…] [--write]
//
// It writes ONE file per deck, `assemblies/turntable<L>.yaml`, listing which of the graph's nodes
// are that deck's turntable. Nothing else: no node is renamed, no arrow moved, no line of
// `graph.yaml` touched — an assembly is a drawing, and a set with these files compiles to exactly
// the `ProjectDoc` it compiled to before. See docs/assemblies.md.
//
// So it is the safest migration in this folder, and a second run is a no-op: a deck whose box is
// already there is skipped, and a member the project has not got is simply left out of the map.
//
// Dry by default.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TURNTABLE_REF,
  turntableBox,
  turntableMembers,
} from "@studio/song-schema/stems";
import { formatAssembly } from "@studio/song-schema/yaml/assemblyFile";
import { ASSEMBLIES_DIR } from "@studio/song-schema/yaml/assemblySchema";
import { parseGraph } from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseDocument, type YAMLMap } from "yaml";

const OPTS = { version: "1.2" as const, lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetAssemblies <projet.k7> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** The one `turntables` surface of a project, or null — the same probe every set migration makes. */
function surfaceOf(dir: string): string | null {
  const folder = join(dir, "surfaces");
  if (!existsSync(folder)) return null;
  for (const name of ["desk.yaml", "desk.yml"]) {
    const path = join(folder, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return null;
}

/** The decks a surface declares, by the control ids its mapping is keyed on — `migrateSetPlatter`'s rule. */
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

  const surfaceText = surfaceOf(dir);
  if (!surfaceText) {
    console.error("  ! no surfaces/desk.yaml — this is not a set");
    continue;
  }
  const sdoc = parseDocument(surfaceText, OPTS);
  if (sdoc.get("type") !== "turntables") {
    console.error("  ! surfaces/desk.yaml is not a `turntables` surface");
    continue;
  }
  const mapping = sdoc.get("mapping") as YAMLMap | undefined;
  const decks = mapping?.items ? decksOf(mapping) : [];
  if (!decks.length) {
    console.error(
      "  ! its mapping names no deck (`<deck>.tempo`) — nothing to do",
    );
    continue;
  }

  const graphPath = join(dir, GRAPH_FILE);
  if (!existsSync(graphPath)) {
    console.error(`  ! no ${GRAPH_FILE}`);
    continue;
  }
  const nodes = new Set(
    Object.keys(
      parseGraph(readFileSync(graphPath, "utf8")).value?.modules ?? {},
    ),
  );

  for (const deck of decks) {
    const box = turntableBox(deck);
    const path = join(dir, ASSEMBLIES_DIR, `${box}.yaml`);
    if (existsSync(path)) {
      console.log(`  = ${ASSEMBLIES_DIR}/${box}.yaml already there`);
      continue;
    }
    // A member the graph has not got is left OUT rather than written as a dangling reference: a set
    // with no stems is a complete set, and `validate()` would be right to complain about the rest.
    const members = Object.fromEntries(
      Object.entries(turntableMembers(deck)).filter(([, n]) => nodes.has(n)),
    );
    if (!Object.keys(members).length) {
      console.error(`  ! ${deck}: the graph holds none of its nodes — skipped`);
      continue;
    }
    const text = formatAssembly(
      { uses: TURNTABLE_REF, members },
      `# ${box} — ${deck}'s nodes, drawn as one appliance.\n` +
        `#\n` +
        `# Written by scripts/migrateSetAssemblies.ts. It changes NOTHING about the sound: this\n` +
        `# file says which of the graph's nodes are one box and nothing else. Its plugs and its\n` +
        `# knobs come from the template it names — see packages/song/docs/assemblies.md.`,
    );
    console.log(
      `  + ${ASSEMBLIES_DIR}/${box}.yaml (${Object.keys(members).length} members)`,
    );
    if (write) {
      mkdirSync(join(dir, ASSEMBLIES_DIR), { recursive: true });
      writeFileSync(path, text, "utf8");
    }
    changed += 1;
  }
}

console.log(
  `${seen} project(s), ${changed} box(es) ${write ? "written" : "to write"}${
    write ? "" : " — re-run with --write"
  }`,
);
