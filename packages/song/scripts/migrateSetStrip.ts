// migrateSetStrip.ts — give a SET the channel strip it lacks: an input trim, a channel fader and
// an echo, per deck.
//
//   npx tsx packages/song/scripts/migrateSetStrip.ts <projet.st0> [more…] [--write]
//
// Before this, a deck's only level control was the crossfader, there was no gain staging at all,
// and nothing past the filter. See packages/st0-plugins/docs/turntables/mix.md and docs/fx.md.
//
// The one edit that is not an addition: the strip's HEAD moves from the EQ to the trim, because
// all five of a deck's lanes must meet in front of the trim for it to reach a separated record.
// That renames the chain, so `bus_only:` is rewritten too — it must name a head, not a step.
//
// Idempotent, dry by default, and through the yaml Document API so comments and key order come back
// byte-identical.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { ECHO_BIND, stripNodeFiles } from "../src/scaffoldSet.ts";

/** As `yaml/graphFile.ts` pins it: 1.2 keeps `5:1:1` a string, no wrapping keeps `bus_only:` on one line. */
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateSetStrip <projet.st0> [more…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

/** What one deck needs, read off the surface and the graph rather than assumed. */
interface Deck {
  /** The control-id prefix — `deckA`. */
  id: string;
  /** Its EQ node, from `<deck>.eqLow` — today's chain head, and tomorrow's second step. */
  eq: string;
  /** Its filter node, from `<deck>.filter` — the split the channel fader hangs off. */
  filter: string;
  /** Its fade node, from the `crossfade` binding — what the new echo will feed. */
  fade: string;
  trim: string;
  level: string;
  echo: string;
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

/** The `crossfade` line's own module, and the one its `also:` names — one fade per deck. */
function fadesOf(mapping: YAMLMap): string[] {
  const v = mapping.get("crossfade") as
    | { get?: (k: string) => unknown }
    | undefined;
  const first = v?.get?.("module");
  const also = v?.get?.("also") as { get?: (k: string) => unknown } | undefined;
  const second = also?.get?.("module");
  return [first, second].filter(
    (x): x is string => typeof x === "string" && !!x,
  );
}

/** The decks the surface declares, in the order its mapping names them. */
function decksOf(mapping: YAMLMap): Deck[] {
  const fades = fadesOf(mapping);
  const out: Deck[] = [];
  for (const item of mapping.items) {
    const key = String(
      (item as { key?: { value?: unknown } }).key?.value ?? "",
    );
    const [id, control] = key.split(".");
    if (!id || control !== "filter") continue;
    const filter = moduleOf(mapping, key);
    const eq = moduleOf(mapping, `${id}.eqLow`);
    // The crossfade names its fades in deck order, which is the order this loop runs in.
    const fade = fades[out.length];
    // Refused rather than half-wired: guessing a node name writes a strip nobody asked for.
    if (!filter || !eq || !fade) {
      console.error(
        `  ! ${id}: mapping has no ${!filter ? key : !eq ? `${id}.eqLow` : "crossfade fade"} — cannot place the strip`,
      );
      continue;
    }
    const letter = id.replace(/^deck/, "") || id;
    out.push({
      id,
      eq,
      filter,
      fade,
      trim: `trim${letter}`,
      level: `level${letter}`,
      echo: `echo${letter}`,
      letter,
    });
  }
  return out;
}

/** Where `name` sits among the `modules:` entries, or -1. */
const lineOf = (modules: YAMLMap, name: string): number =>
  modules.items.findIndex(
    (i) => String((i as { key?: { value?: unknown } }).key?.value) === name,
  );

/** Every destination equal to `from` becomes `to` — how the five lanes are moved onto the trim.
 *
 * Through `createNode` and never a bare `{ value }`: the yaml API serialises a plain object as a
 * MAP, so the graph comes back with `[ { value: trimA } ]` and every lane is silently unwired. */
function redirect(
  doc: { createNode: (v: unknown) => unknown },
  modules: YAMLMap,
  from: string,
  to: string,
): void {
  for (const item of modules.items) {
    const seq = (item as { value?: YAMLSeq }).value;
    if (!seq?.items) continue;
    seq.items = seq.items.map((i) =>
      String((i as { value?: unknown })?.value ?? i) === from
        ? (doc.createNode(to) as typeof i)
        : i,
    );
  }
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

  const decks = decksOf(mapping);
  const files: Record<string, string> = {};
  /** The mapping lines, held back so the block lands where the scaffold puts it — and grouped
   *  BY CONTROL rather than by deck, which is the order the scaffold writes them in. */
  const bind: Record<string, ReturnType<typeof sdoc.createPair>[]> = {
    trim: [],
    level: [],
    echo: [],
  };
  /** The chain heads `bus_only:` should name once every deck has been walked. */
  const heads: string[] = [];
  let touched = false;

  for (const deck of decks) {
    // Reported per deck, since a half-migrated set is a real state after an interrupted run.
    if (modules.has(deck.trim)) {
      console.log(`  = ${deck.id}: already has ${deck.trim}`);
      heads.push(deck.trim);
      continue;
    }

    // The five lanes move onto the trim FIRST, while `eq` is still what they all name.
    redirect(gdoc, modules, deck.eq, deck.trim);

    const flowSeq = (to: string) => {
      const seq = gdoc.createNode([to]) as YAMLSeq;
      seq.flow = true;
      return seq;
    };

    // `trim<X>: [ eq<X> ]`, immediately before the EQ's own line — the strip reads in signal order.
    const atEq = lineOf(modules, deck.eq);
    modules.items.splice(
      atEq < 0 ? modules.items.length : atEq,
      0,
      gdoc.createPair(deck.trim, flowSeq(deck.eq)),
    );

    // The filter's FIRST destination becomes the channel fader; its second is the cue, untouched.
    const dests = modules.get(deck.filter) as YAMLSeq | undefined;
    if (dests?.items?.length)
      dests.items[0] = gdoc.createNode(
        deck.level,
      ) as (typeof dests.items)[number];

    // …then `level -> echo -> fade`, inserted before the fade's own line so the run stays in order.
    const atFade = lineOf(modules, deck.fade);
    modules.items.splice(
      atFade < 0 ? modules.items.length : atFade,
      0,
      gdoc.createPair(deck.level, flowSeq(deck.echo)),
      gdoc.createPair(deck.echo, flowSeq(deck.fade)),
    );

    for (const [control, module, param] of [
      ["trim", deck.trim, "Trim"],
      ["level", deck.level, "Gain"],
      ["echo", deck.echo, ECHO_BIND],
    ] as const) {
      const value = sdoc.createNode({ module, param }) as { flow?: boolean };
      value.flow = true;
      bind[control].push(sdoc.createPair(`${deck.id}.${control}`, value));
    }

    Object.assign(files, stripNodeFiles([deck.id]));
    heads.push(deck.trim);
    touched = true;
    console.log(
      `  + ${deck.id}: ${deck.trim} heads the strip, ${deck.filter} -> ${deck.level} -> ${deck.echo} -> ${deck.fade}`,
    );
  }

  if (!touched) continue;
  changed += 1;

  // `bus_only:` must name the chain's HEAD, and the head just moved from the EQ to the trim.
  // Rewritten in place rather than appended to: leaving the EQ there would name a step.
  const busOnly = gdoc.get("bus_only", true) as YAMLSeq | undefined;
  if (busOnly?.items)
    busOnly.items = heads.map(
      (h) => gdoc.createNode(h) as (typeof busOnly.items)[number],
    );

  // After the LAST `.cue`, which is where the scaffold's own block sits — the stems follow it.
  let last = -1;
  mapping.items.forEach((i, n) => {
    const key = String((i as { key?: { value?: unknown } }).key?.value);
    if (key.endsWith(".cue") || key.endsWith(".filter")) last = n;
  });
  mapping.items.splice(
    last < 0 ? mapping.items.length : last + 1,
    0,
    ...bind.trim,
    ...bind.level,
    ...bind.echo,
  );

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
    "The trim and the fader rest at unity, so nothing sounds different until you move one — " +
    "see packages/st0-plugins/docs/turntables/mix.md.",
);
