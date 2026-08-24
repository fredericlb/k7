// migrateSetStems.ts — give a SET the four stem lanes per deck it lacks.
//
//   npx tsx packages/song/scripts/migrateSetStems.ts <projet.st0> [more…] [--write]
//
// Adds eight lanes, sixteen nodes, eight bypasses and eight mapping lines, and nothing else.
// Idempotent, dry by default, and through the yaml Document API so comments and key order come
// back byte-identical.
//
// It does NOT write the surface's `stems:` line: separating is minutes per song, so it happens
// because a set asked for it. See packages/dsp/docs/stemcut.md for what the lanes are.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  STEMS,
  stemControl,
  stemCut,
  stemLane,
} from "@studio/song-schema/stems";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { type Pair, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { stemNodeFiles } from "../src/scaffoldSet.ts";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps `bypassed:` on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetStems <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** What one deck needs to be wired, read off the surface rather than assumed. */
interface Deck {
  /** The control-id prefix AND the lane's node name — `deckA`. */
  id: string;
  /** The node its five lanes meet on, from the mapping's `<deck>.eqLow`. */
  eq: string;
  /** From `<deck>.tempo`: the stems go in after it, so the file reads deck, tempo, stems, bus. */
  tempo: string;
}

/** The one `turntables` surface of a project, or null with the reason. */
function surfaceOf(dir: string): { path: string; text: string } | null {
  const folder = join(dir, "surfaces");
  if (!existsSync(folder)) return null;
  for (const name of ["desk.yaml", "desk.yml"]) {
    const path = join(folder, name);
    if (existsSync(path)) return { path, text: readFileSync(path, "utf8") };
  }
  return null;
}

/** The decks the surface declares, in the order its mapping names them. */
function decksOf(mapping: YAMLMap): Deck[] {
  const out: Deck[] = [];
  for (const item of mapping.items) {
    const key = String(
      (item as { key?: { value?: unknown } }).key?.value ?? "",
    );
    // `deckA.tempo` is the one control every deck has and the one this needs anyway.
    const [id, control] = key.split(".");
    if (!id || control !== "tempo") continue;
    const tempo = moduleOf(mapping, key);
    const eq = moduleOf(mapping, `${id}.eqLow`);
    // Refused rather than half-wired: inventing a node name writes eight lanes nobody asked for.
    if (!tempo || !eq) {
      console.error(
        `  ! ${id}: mapping has no ${!tempo ? `${key}` : `${id}.eqLow`} — cannot tell which node its stems meet on`,
      );
      continue;
    }
    out.push({ id, eq, tempo });
  }
  return out;
}

/** The `module:` a mapping line names. */
function moduleOf(mapping: YAMLMap, control: string): string | null {
  const v = mapping.get(control) as
    | { get?: (k: string) => unknown }
    | undefined;
  const m = v?.get?.("module");
  return typeof m === "string" && m ? m : null;
}

/** Rewrite the note above `bypassed:` ONLY where it is still the one the old scaffold wrote. */
function retellBypassed(contents: { items?: Pair[] } | null): void {
  const pair = contents?.items?.find(
    (i) => String((i.key as { value?: unknown })?.value) === "bypassed",
  );
  const key = pair?.key as { commentBefore?: string } | undefined;
  if (!key?.commentBefore?.includes("crossfade ONLY")) return;
  key.commentBefore =
    " Heard through the bus ONLY — see scaffoldSet.ts for why this is not optional.";
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
  if (!mapping?.items?.length) {
    console.error("  ! that surface wires nothing — nothing to extend");
    continue;
  }
  const decks = decksOf(mapping);
  if (!decks.length) continue;

  const graphPath = join(dir, GRAPH_FILE);
  if (!existsSync(graphPath)) {
    console.error(`  ! no ${GRAPH_FILE}`);
    continue;
  }
  const gdoc = parseDocument(readFileSync(graphPath, "utf8"), OPTS);
  const modules = gdoc.get("modules") as YAMLMap | undefined;
  if (!modules) {
    console.error(`  ! ${GRAPH_FILE} has no \`modules:\``);
    continue;
  }

  const files: Record<string, string> = {};
  let touched = false;

  for (const deck of decks) {
    // Reported per deck, since a half-migrated set is a real state after an interrupted run.
    if (modules.has(stemLane(deck.id, STEMS[0]))) {
      console.log(`  = ${deck.id}: already has its stem lanes`);
      continue;
    }
    if (!modules.has(deck.id)) {
      console.error(
        `  ! ${deck.id}: no lane by that name in ${GRAPH_FILE} — the mapping and the graph disagree`,
      );
      continue;
    }

    // Right after `tempo<X>`, so the file reads deck, tempo, stems, bus — the signal's order.
    const at = modules.items.findIndex(
      (i) =>
        String((i as { key?: { value?: unknown } }).key?.value) === deck.tempo,
    );
    const pairs = STEMS.flatMap((s) => [
      [stemLane(deck.id, s), stemCut(deck.id, s)],
      [stemCut(deck.id, s), deck.eq],
    ]);
    const made = pairs.map(([from, to]) => {
      const seq = gdoc.createNode([to]) as YAMLSeq;
      seq.flow = true; // `[ eqA ]`, as every other line of this file is written
      return gdoc.createPair(from, seq);
    });
    modules.items.splice(at < 0 ? modules.items.length : at + 1, 0, ...made);

    /** Every source lane is muted, THE DECK'S OWN INCLUDED: `out` is parallel, so it is heard raw. */
    for (const lane of [deck.id, ...STEMS.map((s) => stemLane(deck.id, s))]) {
      const bypassed = gdoc.get("bypassed") as YAMLSeq | undefined;
      if (!bypassed) {
        gdoc.set("bypassed", [lane]);
        continue;
      }
      // `add` does not dedupe, and deck B is normally in there already.
      const held = (bypassed.items as { value?: unknown }[]).some(
        (i) => String(i?.value ?? i) === lane,
      );
      if (!held) bypassed.add(lane);
    }

    for (const s of STEMS)
      sdoc.setIn(
        ["mapping", stemControl(deck.id, s)],
        sdoc.createNode({ module: stemCut(deck.id, s), param: "Cut" }),
      );

    Object.assign(files, stemNodeFiles([deck.id]));
    touched = true;
    console.log(
      `  + ${deck.id}: ${STEMS.length} lanes, ${STEMS.length * 2} nodes, ${STEMS.length} mapping lines`,
    );
  }

  if (!touched) continue;
  changed += 1;
  retellBypassed(gdoc.contents as { items?: Pair[] } | null);

  // Flow maps like the existing lines, set after the fact because `createNode` has no say in it.
  for (const s of STEMS)
    for (const deck of decks) {
      const v = (sdoc.get("mapping") as YAMLMap).get(stemControl(deck.id, s)) as
        | { flow?: boolean }
        | undefined;
      if (v) v.flow = true;
    }

  if (!write) {
    console.log("  (dry run — pass --write to save)");
    continue;
  }
  writeFileSync(graphPath, gdoc.toString(OUT), "utf8");
  writeFileSync(surface.path, sdoc.toString(OUT), "utf8");
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, "utf8");
  }
  console.log(
    `  written: ${GRAPH_FILE}, ${surface.path}, ${Object.keys(files).length} nodes`,
  );
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}. ` +
    'The desk can also SEPARATE a record put on unprepared — add `stems: "@st0/stems"` ' +
    "to the surface for that; it is left out here because a separation costs minutes a song.",
);
