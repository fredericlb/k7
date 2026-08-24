// migrateSetFades.ts — turn a SET's one crossfade module into the two fades that can be heard.
//
//   npx tsx packages/song/scripts/migrateSetFades.ts <projet.st0> [more…] [--write]
//
// A crossfade's second input is a sidechain, and a sidechain reads a track only while that track
// also reaches an audible output — so deck B was heard beside the fader, never through it. Two
// one-input fades have no second port. See packages/song/docs/setProject.md.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order survive.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { fadeNodeFile } from "../src/scaffoldSet.ts";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps `bypassed:` on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetFades <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** The `module:` a mapping line names. */
function moduleOf(mapping: YAMLMap, control: string): string | null {
  const v = mapping.get(control) as
    | { get?: (k: string) => unknown }
    | undefined;
  const m = v?.get?.("module");
  return typeof m === "string" && m ? m : null;
}

/** The one destination a `modules:` entry names, or null when it names several. */
function soleDest(modules: YAMLMap, from: string): string | null {
  const seq = modules.get(from) as YAMLSeq | undefined;
  const items = (seq?.items ?? []) as { value?: unknown }[];
  if (items.length !== 1) return null;
  return String(items[0]?.value ?? items[0] ?? "") || null;
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
  if (sdoc.get("type") !== "turntables") {
    console.error("  ! surfaces/desk.yaml is not a `turntables` surface");
    continue;
  }
  const mapping = sdoc.get("mapping") as YAMLMap | undefined;
  const cross = mapping ? moduleOf(mapping, "crossfade") : null;
  if (!mapping || !cross) {
    console.error("  ! no `crossfade:` line in the mapping — nothing to move");
    continue;
  }
  if (/^fade/.test(cross)) {
    console.log("  = already on two fades");
    continue;
  }

  const graphPath = join(dir, GRAPH_FILE);
  const gdoc = parseDocument(readFileSync(graphPath, "utf8"), OPTS);
  const modules = gdoc.get("modules") as YAMLMap | undefined;
  if (!modules) {
    console.error(`  ! ${GRAPH_FILE} has no \`modules:\``);
    continue;
  }

  // Where the crossfade sent its blend — the fades inherit it, so a master chain survives.
  const after = soleDest(modules, cross);
  if (!after) {
    console.error(
      `  ! \`${cross}:\` names no single destination — migrate this one by hand`,
    );
    continue;
  }

  // Which strip arrived BARE and which on the port: that is which side each fade takes.
  const sides: { feeder: string; letter: string; side: 0 | 1 }[] = [];
  for (const item of modules.items) {
    const from = String(
      (item as { key?: { value?: unknown } }).key?.value ?? "",
    );
    const to = soleDest(modules, from);
    if (to !== cross && to !== `${cross}#b`) continue;
    // `filterA` → `A`: the letter the deck's whole strip is already named by.
    const letter = from.replace(/^[a-z]+/, "");
    if (!letter) {
      console.error(`  ! cannot read a deck letter off \`${from}\``);
      continue;
    }
    sides.push({ feeder: from, letter, side: to === cross ? 0 : 1 });
  }
  if (sides.length !== 2) {
    console.error(
      `  ! expected two strips feeding \`${cross}\`, found ${sides.length}`,
    );
    continue;
  }

  const files: Record<string, string> = {};
  for (const { feeder, letter, side } of sides) {
    const fade = `fade${letter}`;
    // The strip now ends on its own fade…
    const seq = gdoc.createNode([fade]) as YAMLSeq;
    seq.flow = true;
    modules.set(feeder, seq);
    // …and the fade lands where the crossfade used to, right after it in the file.
    const dest = gdoc.createNode([after]) as YAMLSeq;
    dest.flow = true;
    const at = modules.items.findIndex(
      (i) => String((i as { key?: { value?: unknown } }).key?.value) === feeder,
    );
    modules.items.splice(at + 1, 0, gdoc.createPair(fade, dest));
    Object.assign(files, fadeNodeFile(letter, side));
  }

  // The crossfade's own line goes: its destination now belongs to the two fades.
  modules.delete(cross);

  const a = sides.find((s) => s.side === 0);
  const b = sides.find((s) => s.side === 1);
  mapping.set(
    "crossfade",
    sdoc.createNode({
      module: `fade${a?.letter}`,
      param: "Mix",
      also: { module: `fade${b?.letter}`, param: "Mix" },
    }),
  );
  const line = mapping.get("crossfade") as { flow?: boolean } | undefined;
  if (line) line.flow = true;

  changed += 1;
  console.log(
    `  + ${cross} → fade${a?.letter} (Side 0) + fade${b?.letter} (Side 1), both landing on ${after}`,
  );
  if (!write) {
    console.log("  (dry run — pass --write to save)");
    continue;
  }
  writeFileSync(graphPath, gdoc.toString(OUT), "utf8");
  writeFileSync(surfacePath, sdoc.toString(OUT), "utf8");
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  // The old node file, whose module nothing names any more.
  const oldNode = join(dir, "nodes", `${cross}.yaml`);
  if (existsSync(oldNode)) rmSync(oldNode);
  console.log(
    `  written: ${GRAPH_FILE}, ${surfacePath}, ${Object.keys(files).length} node(s); removed nodes/${cross}.yaml`,
  );
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}. ` +
    "`@st0/audio/utility/fade` must be in the library the project reads — " +
    "packages/dsp/modules/ is a place to copy FROM (docs/sharedFolders.md).",
);
