// rackBuilder.ts — the rack builder's arithmetic: which pad fires which note, in which order the
// taps are written, where the samples go, and the KIT node the CREATE button commits — a node of the
// library's `k7-rack` on its `samples` engine, carrying its own taps (packages/song/docs/racks.md).
// Pure, because what lands in the project deserves a test; the popin is a grid drawn around these numbers.

import { stringify } from "@studio/k7x/print";
import { RACK_FIRST_NOTE } from "@studio/song-schema/moduleTypes";
import { m } from "./paraglide/messages.js";
import { projectDir } from "./projectPaths";

/** The grid's side. 4×4 today — sixteen pads, the drum-machine page. */
export const GRID = 4;
/** The MIDI note a pad fires: the grid READS like a drum machine, bottom-left 36 to top-right 51, with `row` counting from the TOP. */
export const padNote = (row: number, col: number): number =>
  RACK_FIRST_NOTE + (GRID - 1 - row) * GRID + col;

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

/** The rack every kit is a node of — a LIBRARY module whose engines are its kits, the kit being the node's. */
const RACK_MODULE = "instruments/k7-rack";
/** …and its SAMPLER engine, the one that plays the node's own taps; the module's default is an SFZ kit. */
const RACK_ENGINE = "samples";

/** Which library's sampler a kit extends: `@k7-core`'s first, else any library's; null when none holds one. */
export function rackModuleRef(baseModules: readonly string[]): string | null {
  const found = baseModules.filter((r) =>
    new RegExp(`^@(?!workspace/|engine/)[^/]+/${RACK_MODULE}$`).test(r),
  );
  return found.find((r) => r.startsWith("@k7-core/")) ?? found[0] ?? null;
}

/** Where a kit's samples land: the PROJECT's own samples/, or one of the account's libraries'. */
export type KitDestination = "project" | { library: string };

/** The folder the samples are uploaded into, workspace-relative; `project` is the active project's folder. */
export function kitUploadDir(
  dest: KitDestination,
  kit: string,
  project: string,
): string {
  if (dest === "project") {
    const p = projectDir(project);
    return `${p ? `${p}/` : ""}samples/${kit}`;
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
  /** The sampler the kit extends — false when no library holds one. */
  hasRack = true,
): string[] {
  const out: string[] = [];
  if (!hasRack) out.push(m["rb.noRack"]({ module: RACK_MODULE }));
  if (!name) out.push(m["rb.noName"]());
  else if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) out.push(m["rb.nameShape"]());
  if (taken.includes(name)) out.push(m["rb.exists"]({ name }));
  if (!pads.length) out.push(m["rb.noSample"]());
  const seen = new Set<string>();
  for (const p of pads) {
    if (!/^[A-Za-z0-9_-]+$/.test(p.symbol))
      out.push(m["rb.badSymbol"]({ symbol: p.symbol }));
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

/** The KIT node the builder writes, as k7x: a node of the sampler, one tap per pad, one per line, in the order given. */
export function buildKitNode(
  name: string,
  pads: readonly RackPad[],
  dest: KitDestination,
  /** The sampler it is a node of, as `rackModuleRef` found it. */
  rackRef: string,
): string {
  const symbols: Record<string, { note: number; sample: string }> = {};
  for (const p of pads)
    symbols[p.symbol] = {
      note: p.note,
      sample: kitSampleRef(dest, name, p.fileName),
    };
  // `BD: { note: 36, sample: … }` — a kit is read down, the way a drum map is.
  return stringify(
    { extends: rackRef, engine: RACK_ENGINE, rack: { symbols } },
    {
      header: [
        `${name} — a kit, built with the rack builder: each tap a note and the sample it fires.`,
      ],
      inline: (path) =>
        path.length === 3 && path[0] === "rack" && path[1] === "symbols",
    },
  );
}
