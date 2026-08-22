// migrateSetStems.ts — give a SET written before the stems the four lanes per deck it is missing.
//
// A set scaffolded today has five lanes a deck: the record, and one per separated instrument,
// each through a `stemcut` whose gain is negative so the five summing at the EQ SUBTRACT
// (packages/dsp/docs/stemcut.md). A set written before that has one lane a deck, so its desk
// draws no stem column at all — deliberately, since four dead knobs are worse than none.
//
// This adds what is missing and nothing else: eight lanes, sixteen nodes, eight bypasses and
// eight mapping lines. Idempotent — a set that already has them is reported and left alone.
//
// Through the yaml Document API rather than by rewriting text, like migrateDocFields beside it:
// every comment, the key order and the inline flow maps come back byte-identical. Dry by default;
// pass --write to actually save.
//
//   npx tsx packages/song/scripts/migrateSetStems.ts <projet.st0> [more…] [--write]
//
// It does NOT write the surface's `stems:` line. That one names the chain that separates, and a
// separation is minutes of arithmetic per song — so it happens because a set ASKED for it, never
// because a migration decided. The script says the line to add.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Pair, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { stemNodeFiles } from "../src/scaffoldSet.ts";
import { STEMS, stemControl, stemCut, stemLane } from "../src/stems.ts";
import { GRAPH_FILE } from "../src/yaml/graphSchema.ts";

/** What `yaml/graphFile.ts` pins, restated: 1.2 so a `5:1:1` scalar stays a string, and no
 *  wrapping, which is what keeps `bypassed:` on one line however many lanes it grows. */
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
  /** The node its record already flows through, from `<deck>.tempo`. Where the stems are
   *  inserted, so the file reads deck, tempo, stems, bus. */
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
    // Refused rather than half-wired: without the bus this deck's stems have nowhere to meet,
    // and inventing a node name would put eight lanes into a graph nobody wrote.
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

/**
 * The line above `bypassed:` stopped being true, so it is rewritten — but ONLY when it is still
 * the one the old scaffold wrote.
 *
 * It said "heard through the crossfade only", which was right when a deck was one lane feeding a
 * run. Five feeders make the EQ a meeting point, so the run breaks there and what the lanes are
 * heard through is a BUS. Prose that quietly stops matching the file under it is worse than no
 * prose; prose somebody has edited themselves is not this script's to touch.
 */
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
    // Already done — reported per deck rather than per project, since a half-migrated set is a
    // real state (an interrupted run) and saying "nothing to do" about it would be wrong.
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

    // Inserted right after `tempo<X>: [ eq<X> ]`, so the file reads deck, tempo, stems, bus —
    // the order scaffoldSet writes and the order the signal takes.
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

    /**
     * Every source lane is heard through the bus ONLY, and THE DECK'S OWN LANE IS ONE OF THEM.
     *
     * That last part is what a migration gets wrong if it only adds the stems. Before this, deck
     * A's lane flowed into a RUN — one feeder, so the EQ was a step and the signal went through
     * it. Five feeders make the EQ a meeting point, the run breaks there, and every lane reaches
     * it as a send instead. `out` compiles as a PARALLEL path, so an unmuted deck A would now be
     * heard twice: once through its EQ and the crossfade, once raw, with the crossfader unable to
     * take either away. Deck B was already muted because it ended on a port; deck A was not.
     *
     * For a stem lane the same rule is worse than a duplicate — an unmuted one adds its INVERTED
     * copy straight to the master, which is the subtraction happening in the wrong place.
     */
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

  // The mapping's new entries are block maps by default; the file's existing lines are inline
  // flow maps, and a migration that changed the shape of a file it touched would read as a
  // rewrite. Set after the fact because `createNode` has no say in it.
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
