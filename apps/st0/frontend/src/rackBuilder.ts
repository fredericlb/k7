// rackBuilder.ts — the rack builder's arithmetic: which pad fires which note, in which order the
// taps are written, where the samples go, and the KIT node the CREATE button commits — a node of the
// plain `rack` sampler carrying its own taps (packages/song/docs/racks.md). Pure, because what lands
// in the project is exactly what deserves a test; the popin is a grid drawn around these numbers.

import { Document } from "yaml";
import { m } from "./paraglide/messages.js";

/** The grid's side. 4×4 today — sixteen pads, the drum-machine page. */
export const GRID = 4;
/** The bottom-left pad's note. 36 is C1, where every pad convention starts. */
export const FIRST_NOTE = 36;

/** The MIDI note a pad fires: the grid READS like a drum machine, bottom-left 36 to top-right 51, with `row` counting from the TOP. */
export const padNote = (row: number, col: number): number =>
  FIRST_NOTE + (GRID - 1 - row) * GRID + col;

/** Every cell in NOTE order — the order the symbols are WRITTEN in, so the hints, the colours and the sequencer read the grid as it plays. */
export function cellsInNoteOrder(): { row: number; col: number }[] {
  const out: { row: number; col: number }[] = [];
  for (let row = GRID - 1; row >= 0; row--)
    for (let col = 0; col < GRID; col++) out.push({ row, col });
  return out;
}

/** A pad's default symbol: the file's stem, upper-cased and squeezed to the characters a symbol is addressed by. Empty in, 'PAD' out. */
export function defaultSymbol(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, "");
  const clean = stem
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "PAD";
}

export interface RackPad {
  symbol: string;
  fileName: string; // as it will sit in the kit's folder under samples/
  note: number;
}

/** The sampler every kit is a node of: nothing but `type: rack`, the kit being the node's. */
export const RACK_MODULE = "instruments/rack";
export const RACK_MODULE_REF = `@workspace/${RACK_MODULE}`;
/** Where it is written when the workspace has none yet — workspace-relative, as every api path is. */
export const RACK_MODULE_FILE = `_modules/${RACK_MODULE}/module.yaml`;
export const RACK_MODULE_YAML =
  "# rack — the sampler a kit is a node of. It carries no sounds: each node of it states its own\n" +
  "# taps, a note and the sample it fires (packages/song/docs/racks.md).\n" +
  "type: rack\n";

/** Where a kit's samples land: the PROJECT's own samples/, or one of the account's libraries'. */
export type KitDestination = "project" | { library: string };

/** The folder the samples are uploaded into, workspace-relative; `project` is the active project's folder. */
export function kitUploadDir(
  dest: KitDestination,
  kit: string,
  project: string,
): string {
  if (dest === "project") {
    const p = project.replace(/\\/g, "/").replace(/\/+$/, "");
    return `${p && p !== "." ? `${p}/` : ""}samples/${kit}`;
  }
  return `_libraries/${dest.library}/samples/${kit}`;
}

/** The name a tap writes for one of them: `@project/<kit>/<file>` or `@<library>/<kit>/<file>`. */
export const kitSampleRef = (
  dest: KitDestination,
  kit: string,
  file: string,
): string => `@${dest === "project" ? "project" : dest.library}/${kit}/${file}`;

/** What stops a CREATE, as sentences — the name becomes a node and a folder, and a symbol is how a note finds its sound. */
export function rackIssues(
  name: string,
  pads: readonly RackPad[],
  /** The project's node names: the kit IS a node, and two cannot share one. */
  taken: readonly string[] = [],
): string[] {
  const out: string[] = [];
  if (!name) out.push(m["rb.noName"]());
  else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) out.push(m["rb.nameShape"]());
  if (taken.includes(name)) out.push(m["rb.exists"]({ name }));
  if (!pads.length) out.push(m["rb.noSample"]());
  const seen = new Set<string>();
  for (const p of pads) {
    if (!/^[A-Za-z0-9_-]+$/.test(p.symbol))
      out.push(`symbole invalide : "${p.symbol}"`);
    else if (seen.has(p.symbol))
      out.push(m["rb.dupSymbol"]({ symbol: p.symbol }));
    seen.add(p.symbol);
  }
  const files = new Set<string>();
  for (const p of pads) {
    if (files.has(p.fileName)) out.push(m["rb.samePad"]({ file: p.fileName }));
    files.add(p.fileName);
  }
  return out;
}

/** The KIT node the builder writes: a node of the sampler, one tap per pad, one per line, in the order given. */
export function buildKitNodeYaml(
  name: string,
  pads: readonly RackPad[],
  dest: KitDestination,
): string {
  const symbols: Record<string, { note: number; sample: string }> = {};
  for (const p of pads)
    symbols[p.symbol] = {
      note: p.note,
      sample: kitSampleRef(dest, name, p.fileName),
    };
  const doc = new Document(
    { extends: RACK_MODULE_REF, rack: { symbols } },
    { version: "1.2" },
  );
  // `BD: { note: 36, sample: … }` — a kit is read down, the way a drum map is.
  const map = doc.getIn(["rack", "symbols"]) as {
    items: { value: { flow?: boolean } }[];
  };
  for (const it of map.items) it.value.flow = true;
  return (
    `# ${name} — a kit, built with the rack builder: each tap a note and the sample it fires.\n` +
    doc.toString({ lineWidth: 0 })
  );
}
