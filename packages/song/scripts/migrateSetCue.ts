// migrateSetCue.ts — give a SET the headphone send per deck it lacks.
//
//   npx tsx packages/song/scripts/migrateSetCue.ts <projet.st0> [more…] [--write]
//
// Per deck: a second destination on its filter, a `cue<X>: [ CUE ]` line, one node file, one
// mapping line — and its STRIP into `bus_only:`, without which the strip's dry path reaches the
// master unfaded and every crossfader position sounds the same. See packages/song/docs/cue.md.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order come back
// byte-identical. It does NOT touch ~/.studio: which pair the headphones are on is a fact about a
// MACHINE, set once with `system cue`, and a project that travels must not carry one.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CUE_NODE } from "@studio/song-schema/moduleTypes";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { type Pair, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { BUS_ONLY_NOTE, cueNodeFile } from "../src/scaffoldSet.ts";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps `bus_only:` on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetCue <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** What one deck needs, read off the surface and the graph rather than assumed. */
interface Deck {
  /** The control-id prefix — `deckA`. */
  id: string;
  /** Where the tap is taken, from `<deck>.filter`: after the EQ and the filter, before the fade. */
  filter: string;
  /** The node its lanes meet on, from `<deck>.eqLow` — the STRIP, which loses its dry path. */
  eq: string;
  /** What the new node is called: `cueA` for `deckA`, and the deck's own name if it is not `deck<X>`. */
  cue: string;
  /** The letter the node file's prose is written in. */
  letter: string;
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

/** The `module:` a mapping line names. */
function moduleOf(mapping: YAMLMap, control: string): string | null {
  const v = mapping.get(control) as
    | { get?: (k: string) => unknown }
    | undefined;
  const m = v?.get?.("module");
  return typeof m === "string" && m ? m : null;
}

/** The decks the surface declares, in the order its mapping names them. */
function decksOf(mapping: YAMLMap): Deck[] {
  const out: Deck[] = [];
  for (const item of mapping.items) {
    const key = String((item as { key?: { value?: unknown } }).key?.value ?? "");
    const [id, control] = key.split(".");
    // `filter` rather than `tempo`: it is the tap point, so a deck without one has nowhere to tap.
    if (!id || control !== "filter") continue;
    const filter = moduleOf(mapping, key);
    const eq = moduleOf(mapping, `${id}.eqLow`);
    // Refused rather than half-wired: guessing a node name writes a send nobody asked for.
    if (!filter || !eq) {
      console.error(
        `  ! ${id}: mapping has no ${!filter ? key : `${id}.eqLow`} — cannot tell where to tap`,
      );
      continue;
    }
    const letter = id.replace(/^deck/, "") || id;
    out.push({ id, filter, eq, cue: `cue${letter}`, letter });
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
  /** The strips that lose their dry path — collected, since `bus_only:` is one line for the file. */
  const lift: string[] = [];
  /** The mapping lines, likewise: they go in as a BLOCK, where the scaffold puts them. */
  const bind: Pair[] = [];
  let touched = false;

  for (const deck of decks) {
    // Reported per deck, since a half-migrated set is a real state after an interrupted run.
    if (modules.has(deck.cue)) {
      console.log(`  = ${deck.id}: already has ${deck.cue}`);
      continue;
    }
    const dests = modules.get(deck.filter) as YAMLSeq | undefined;
    if (!dests?.items) {
      console.error(
        `  ! ${deck.id}: no \`${deck.filter}\` in ${GRAPH_FILE} — the mapping and the graph disagree`,
      );
      continue;
    }

    // What it fed BEFORE, read first: the new line goes after that one, so the file reads fade then cue.
    const wasFeeding = String(
      (dests.items[0] as { value?: unknown })?.value ?? "",
    );
    // The SECOND destination, beside whatever the filter already feeds — that is the whole edit.
    dests.add(gdoc.createNode(deck.cue));
    dests.flow = true;

    // …after the fade's own line when it has one, or after the filter's, which every set has.
    const lineOf = (name: string) =>
      modules.items.findIndex(
        (i) => String((i as { key?: { value?: unknown } }).key?.value) === name,
      );
    const after = lineOf(wasFeeding);
    const at = after >= 0 ? after : lineOf(deck.filter);
    const seq = gdoc.createNode([CUE_NODE]) as YAMLSeq;
    seq.flow = true;
    modules.items.splice(
      at < 0 ? modules.items.length : at + 1,
      0,
      gdoc.createPair(deck.cue, seq),
    );

    // The STRIP loses its dry path, applied once for the lot below — one `bus_only:` per file.
    lift.push(deck.eq);

    // Held back, so the block lands where the scaffold puts it: after the filters, before the stems.
    const value = sdoc.createNode({ module: deck.cue, param: "Mix" }) as {
      flow?: boolean;
    };
    value.flow = true;
    bind.push(sdoc.createPair(`${deck.id}.cue`, value));

    Object.assign(files, cueNodeFile(deck.letter, deck.filter));
    touched = true;
    console.log(
      `  + ${deck.id}: ${deck.filter} -> ${deck.cue} -> ${CUE_NODE}, ${deck.eq} off the dry path`,
    );
  }

  if (!touched) continue;
  changed += 1;

  // `bus_only:` — created once, or extended in place. NOT `bypassed:`, which would also turn the
  // EQ off, the chain being named after its first module. See packages/song/docs/busOnly.md.
  const existing = gdoc.get("bus_only", true) as YAMLSeq | undefined;
  if (existing?.items) {
    for (const eq of lift)
      if (
        !(existing.items as { value?: unknown }[]).some(
          (i) => String(i?.value ?? i) === eq,
        )
      )
        existing.add(gdoc.createNode(eq));
  } else {
    const seq = gdoc.createNode(lift) as YAMLSeq;
    seq.flow = true;
    const pair = gdoc.createPair("bus_only", seq);
    const key = pair.key as { commentBefore?: string; spaceBefore?: boolean };
    key.spaceBefore = true;
    // The scaffold's own words, imported rather than retyped — one file, one note.
    key.commentBefore = BUS_ONLY_NOTE.map((l) => ` ${l}`).join("\n");
    (gdoc.contents as { items: unknown[] }).items.push(pair);
  }

  // After the LAST `.filter`, which is where the scaffold's own block sits — the stems follow it.
  let last = -1;
  mapping.items.forEach((i, n) => {
    if (String((i as { key?: { value?: unknown } }).key?.value).endsWith(".filter"))
      last = n;
  });
  mapping.items.splice(last < 0 ? mapping.items.length : last + 1, 0, ...bind);

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
    `  written: ${GRAPH_FILE}, ${surface.path}, ${Object.keys(files).length} node(s)`,
  );
}

console.log(
  `${changed}/${seen} set(s) ${write ? "migrated" : "would change"}. ` +
    "Then name the headphone pair on THIS machine — `system cue 3+4` — without which a CUE bus " +
    "plays nowhere at all, which is deliberate: see packages/song/docs/cue.md.",
);
