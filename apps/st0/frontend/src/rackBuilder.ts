// rackBuilder.ts — the rack builder's arithmetic: which pad fires which note, in which order
// the symbols are written, and the module.yaml the CREATE button commits. Pure, because what
// lands in the project is exactly what deserves a test — the popin is a grid drawn around
// these numbers.

import { stringify } from "yaml";
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
  fileName: string; // as it will sit in the module's sources/
  note: number;
}

/** What stops a CREATE, as sentences — the name becomes a folder and the symbols become addresses, and a symbol is how a note finds its sound. */
export function rackIssues(
  name: string,
  pads: readonly RackPad[],
  taken: readonly string[] = [],
): string[] {
  const out: string[] = [];
  if (!name) out.push(m["rb.noName"]());
  else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) out.push(m["rb.nameShape"]());
  if (taken.includes(`instruments/${name}`)) out.push(m["rb.exists"]({ name }));
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

/** The module.yaml a samples rack is: `clip` is the bare file name, the file sitting in the module's `sources/`, symbols in the order given. */
export function buildRackModuleYaml(
  name: string,
  pads: readonly RackPad[],
): string {
  const symbols: Record<string, { note: number; clip: string }> = {};
  for (const p of pads) symbols[p.symbol] = { note: p.note, clip: p.fileName };
  return (
    `# ${name} — samples rack, built with the rack builder.\n` +
    stringify(
      { type: "rack", rack: { rack_type: "samples", symbols } },
      { lineWidth: 0 },
    )
  );
}
