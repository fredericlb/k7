// rackTaps.ts — editing a rack NODE's taps: the note each sound answers to and the library sample
// it plays. They are written into the node's own file, never the module's: a rack module is the
// sampler, and each node of it is a kit (packages/song/docs/racks.md). On an alternative other than
// the first, into that set — a knob and a tap follow the same rule.

import { loadModuleRefs, loadModules } from "@studio/song/loader";
import {
  resolvedRack,
  resolvedType,
  resolveModule,
} from "@studio/song/moduleResolve";
import { currentAlternative } from "@studio/song-schema/alternatives";
import { isMap, parseDocument } from "yaml";
import { editModuleFile } from "./projectEdit";

const OPTS = { version: "1.2" as const };

/** The first note a new tap takes when the kit has none: General MIDI's kick. */
const FIRST_NOTE = 36;

/** The node's effective rack, refused when the node is not a rack at all. */
function kitOf(dir: string, node: string) {
  const m = loadModules(dir)[node];
  if (!m) throw new Error(`no node '${node}'`);
  const resolved = resolveModule(m, loadModuleRefs(dir));
  if (resolvedType(resolved) !== "rack")
    throw new Error(`'${node}' is not a rack — only a rack's node has taps`);
  return resolvedRack(resolved);
}

/** Where a tap is written in the node's file: its own `rack:`, or the selected set's. */
function tapBase(text: string): (string | number)[] {
  const at = currentAlternative(
    (parseDocument(text, OPTS).toJS() ?? {}) as {
      alternatives?: unknown;
      alternative?: unknown;
    },
  );
  return at > 0
    ? ["alternatives", at - 1, "rack", "symbols"]
    : ["rack", "symbols"];
}

/** Rewrite the node's file, keeping one tap per line: `BD: { note: 36, sample: … }`. */
function editTaps(
  dir: string,
  node: string,
  change: (
    doc: ReturnType<typeof parseDocument>,
    base: (string | number)[],
  ) => void,
): string {
  return editModuleFile(dir, node, (text) => {
    const doc = parseDocument(text, OPTS);
    const base = tapBase(text);
    change(doc, base);
    const symbols = doc.getIn(base);
    if (isMap(symbols))
      for (const item of symbols.items)
        if (isMap(item.value)) item.value.flow = true;
    return doc.toString({ lineWidth: 0 });
  });
}

/** Set one tap's note or sample on the node; a `null` sample clears it. The tap is made when it is not there. */
export function setTap(
  dir: string,
  node: string,
  symbol: string,
  change: { note?: number; sample?: string | null },
): string {
  const kit = kitOf(dir, node);
  // A tap the node does not state yet starts from the one it inherits, so setting its sample keeps its note.
  const inherited = kit.symbols[symbol];
  return editTaps(dir, node, (doc, base) => {
    const at = [...base, symbol];
    if (!doc.hasIn([...at, "note"]))
      doc.setIn([...at, "note"], change.note ?? inherited?.note ?? FIRST_NOTE);
    if (change.note !== undefined) doc.setIn([...at, "note"], change.note);
    if (change.sample === null) doc.deleteIn([...at, "sample"]);
    else if (change.sample !== undefined)
      doc.setIn([...at, "sample"], change.sample);
  });
}

/** Add a tap: `symbol` or the next free `T<n>`, on the note after the kit's highest. Answers what it made. */
export function addTap(
  dir: string,
  node: string,
  symbol?: string,
): { symbol: string; note: number } {
  const kit = kitOf(dir, node);
  const taken = Object.keys(kit.symbols);
  if (symbol && taken.includes(symbol))
    throw new Error(`'${node}' already has a tap '${symbol}'`);
  let name = symbol;
  for (let i = taken.length + 1; !name; i++)
    if (!taken.includes(`T${i}`)) name = `T${i}`;
  const notes = Object.values(kit.symbols).map((s) => Number(s.note));
  const note = notes.length
    ? Math.min(127, Math.max(...notes) + 1)
    : FIRST_NOTE;
  editTaps(dir, node, (doc, base) => doc.setIn([...base, name, "note"], note));
  return { symbol: name, note };
}

/** Remove a tap the node itself states; one it inherits from its module is refused by name. */
export function removeTap(dir: string, node: string, symbol: string): string {
  const kit = kitOf(dir, node);
  if (!kit.symbols[symbol]) throw new Error(`'${node}' has no tap '${symbol}'`);
  let removed = false;
  const path = editTaps(dir, node, (doc, base) => {
    if (!doc.hasIn([...base, symbol])) return;
    doc.deleteIn([...base, symbol]);
    removed = true;
  });
  if (!removed)
    throw new Error(
      `'${symbol}' comes from ${node}'s module, not from the node — remove it there, or give the node its own kit`,
    );
  return path;
}
