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
import { isMap, isScalar, parseDocument, Scalar } from "yaml";
import { editModuleFile } from "./projectEdit";

const OPTS = { version: "1.2" as const };

/** The first note a new tap takes when the kit has none: General MIDI's kick. */
const FIRST_NOTE = 36;

/** The node's effective rack, refused when the node is not a rack at all. */
export function kitOf(dir: string, node: string) {
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
    // A node with no `rack:` of its own has nothing yaml's deleteIn/setIn can descend through.
    const parent = base.slice(0, -1);
    const made = doc.getIn(parent) == null;
    if (made) doc.setIn(parent, doc.createNode({}));
    change(doc, base);
    // A refused edit leaves the node's file as it found it, not with an empty `rack:` added.
    const kept = doc.getIn(parent);
    if (made && isMap(kept) && !kept.items.length) return text;
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

/** What a tap may be called: one word, since it is a pad's label and a command argument. */
const TAP_NAME = /^[A-Za-z0-9_.+#-]{1,24}$/;

/** Where a positioned add lands: next to `symbol`'s pad, on its `side` in note order. */
export interface TapNear {
  symbol: string;
  side: "before" | "after";
}

/** The free note nearest `from` in the direction of `step`, starting one away — null when the range runs out. */
function freeNote(
  used: Set<number>,
  from: number,
  step: 1 | -1,
): number | null {
  for (let n = from + step; n >= 0 && n <= 127; n += step)
    if (!used.has(n)) return n;
  return null;
}

/** Add a tap: `symbol` or the next free `T<n>`; beside `near` in note order, else after the kit's highest note. */
export function addTap(
  dir: string,
  node: string,
  symbol?: string,
  near?: TapNear,
): { symbol: string; note: number } {
  const kit = kitOf(dir, node);
  const taken = Object.keys(kit.symbols);
  if (symbol && taken.includes(symbol))
    throw new Error(`'${node}' already has a tap '${symbol}'`);
  if (symbol && !TAP_NAME.test(symbol))
    throw new Error(
      `'${symbol}' is not a tap name — one word, letters, digits, _ . + # -`,
    );
  let name = symbol;
  for (let i = taken.length + 1; !name; i++)
    if (!taken.includes(`T${i}`)) name = `T${i}`;
  const notes = Object.values(kit.symbols).map((s) => Number(s.note));
  let note: number;
  if (near) {
    const at = kit.symbols[near.symbol];
    if (!at) throw new Error(`'${node}' has no tap '${near.symbol}'`);
    // The NEAREST free note that side, never a renumbering: a note is what a sequence plays (packages/song/docs/racks.md).
    const found = freeNote(
      new Set(notes),
      Number(at.note),
      near.side === "before" ? -1 : 1,
    );
    if (found === null)
      throw new Error(`no free note ${near.side} ${near.symbol}'s ${at.note}`);
    note = found;
  } else
    note = notes.length ? Math.min(127, Math.max(...notes) + 1) : FIRST_NOTE;
  editTaps(dir, node, (doc, base) => doc.setIn([...base, name, "note"], note));
  return { symbol: name, note };
}

/** Rename a tap the node itself states, in place — its note and sample unchanged; an inherited one is refused. */
export function renameTap(
  dir: string,
  node: string,
  from: string,
  to: string,
): string {
  const kit = kitOf(dir, node);
  if (!kit.symbols[from]) throw new Error(`'${node}' has no tap '${from}'`);
  if (from === to) throw new Error(`'${from}' is already called that`);
  if (kit.symbols[to]) throw new Error(`'${node}' already has a tap '${to}'`);
  if (!TAP_NAME.test(to))
    throw new Error(
      `'${to}' is not a tap name — one word, letters, digits, _ . + # -`,
    );
  let renamed = false;
  const path = editTaps(dir, node, (doc, base) => {
    const symbols = doc.getIn(base);
    if (!isMap(symbols)) return;
    // The KEY is replaced where it stands, so the file keeps its order and every other line.
    for (const item of symbols.items)
      if (isScalar(item.key) && item.key.value === from) {
        item.key = new Scalar(to);
        renamed = true;
      }
  });
  if (!renamed)
    throw new Error(
      `'${from}' comes from ${node}'s module, not from the node — rename it there, or give the node its own kit`,
    );
  return path;
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

/** Replace the kit the node itself states with `taps` — a module's own taps still merge in under it. */
export function setKit(
  dir: string,
  node: string,
  taps: Record<string, { note: number; sample?: string }>,
): string {
  kitOf(dir, node);
  return editTaps(dir, node, (doc, base) => {
    doc.deleteIn(base);
    for (const [symbol, tap] of Object.entries(taps)) {
      doc.setIn([...base, symbol, "note"], tap.note);
      if (tap.sample) doc.setIn([...base, symbol, "sample"], tap.sample);
    }
  });
}
