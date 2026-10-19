// rackTaps.ts — editing a rack NODE's taps: the note each sound answers to and the library sample
// it plays. They are written into the node's own file, never the module's: a rack module is the
// sampler, and each node of it is a kit (packages/song/docs/racks.md). On an alternative other than
// the first, into that set — a knob and a tap follow the same rule.

import type { K7Path } from "@studio/k7x/ast";
import type { K7Scope } from "@studio/k7x/document";
import { readChainProject } from "@studio/song/chainProject";
import { loadModuleRefs, loadModules } from "@studio/song/loader";
import {
  resolvedRack,
  resolvedType,
  resolveModule,
} from "@studio/song/moduleResolve";
import { currentAlternative } from "@studio/song-schema/alternatives";
import { RACK_FIRST_NOTE } from "@studio/song-schema/moduleTypes";
import { calledSubchains } from "@studio/song-schema/yaml/chainSchema";
import { editModuleFile } from "./projectEdit";

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
function tapBase(doc: K7Scope): K7Path {
  const at = currentAlternative((doc.toJS() ?? {}) as Record<string, unknown>);
  return at > 0
    ? ["alternatives", at - 1, "rack", "symbols"]
    : ["rack", "symbols"];
}

/** Edit the node's file at its taps' map; a tap made here is written on one line, `BD: { note: 36, sample: … }`. */
function editTaps(
  dir: string,
  node: string,
  change: (doc: K7Scope, base: K7Path) => void,
): string {
  return editModuleFile(dir, node, (doc) => change(doc, tapBase(doc)));
}

/** Set one tap's note or sample on the node; a `null` sample clears it. The tap is made when it is not there. */
export function setTap(
  dir: string,
  node: string,
  symbol: string,
  change: { note?: number; sample?: string | null; mute?: boolean },
): string {
  const kit = kitOf(dir, node);
  // A tap the node does not state yet starts from the one it inherits, so setting its sample keeps its note.
  const inherited = kit.symbols[symbol];
  return editTaps(dir, node, (doc, base) => {
    const at = [...base, symbol];
    if (!doc.hasIn(at))
      doc.setIn(
        at,
        { note: change.note ?? inherited?.note ?? RACK_FIRST_NOTE },
        { inline: true },
      );
    else if (!doc.hasIn([...at, "note"]))
      doc.setIn(
        [...at, "note"],
        change.note ?? inherited?.note ?? RACK_FIRST_NOTE,
      );
    if (change.note !== undefined) doc.setIn([...at, "note"], change.note);
    if (change.sample === null) doc.deleteIn([...at, "sample"]);
    else if (change.sample !== undefined)
      doc.setIn([...at, "sample"], change.sample);
    // Unmuted is the default, so it is written as nothing rather than `mute: false`.
    if (change.mute === true) doc.setIn([...at, "mute"], true);
    else if (change.mute === false) doc.deleteIn([...at, "mute"]);
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

/** Add a tap: `symbol` or the next free `T<n>`; on note `near` when it is one, beside a tap when it names one, else after the kit's highest. */
export function addTap(
  dir: string,
  node: string,
  symbol?: string,
  near?: TapNear | number,
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
  if (typeof near === "number") {
    if (!Number.isInteger(near) || near < 0 || near > 127)
      throw new Error(`${near} is not a note, 0..127`);
    if (notes.includes(near))
      throw new Error(`'${node}' already has a tap on note ${near}`);
    note = near;
  } else if (near) {
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
    note = notes.length
      ? Math.min(127, Math.max(...notes) + 1)
      : RACK_FIRST_NOTE;
  editTaps(dir, node, (doc, base) =>
    doc.setIn([...base, name], { note }, { inline: true }),
  );
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
    if (!doc.hasIn([...base, from])) return;
    // The KEY is replaced where it stands, so the file keeps its order and every other line.
    doc.renameKey([...base, from], to);
    renamed = true;
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
  const kit = Object.fromEntries(
    Object.entries(taps).map(([symbol, tap]) => [
      symbol,
      { note: tap.note, ...(tap.sample ? { sample: tap.sample } : {}) },
    ]),
  );
  return editTaps(dir, node, (doc, base) => {
    if (!Object.keys(kit).length) doc.deleteIn(base, { prune: true });
    // Applied, not replaced: a tap the new kit keeps as it was keeps its line and its comment.
    else if (doc.hasIn(base)) doc.applyIn(base, kit);
    else doc.setIn(base, kit);
  });
}

/** A node's taps by name: a rack's sounds, or an SFZ kit's pads; none for any other node. */
export function tapsOf(dir: string, node: string): string[] {
  const m = loadModules(dir)[node];
  if (!m) throw new Error(`no node '${node}'`);
  const resolved = resolveModule(m, loadModuleRefs(dir));
  return resolvedType(resolved) === "rack"
    ? Object.keys(resolvedRack(resolved).symbols)
    : Object.keys((resolved as { kit?: Record<string, number> }).kit ?? {});
}

/** Route a tap — a rack's sound or a kit's pad — to a subchain of the node's chain file; `null` returns it to the main output. */
export function setTapOut(
  dir: string,
  node: string,
  tap: string,
  subchain: string | null,
): string {
  const taps = tapsOf(dir, node);
  if (!taps.length)
    throw new Error(
      `'${node}' has no taps — only a rack or an SFZ kit routes one`,
    );
  if (!taps.includes(tap)) throw new Error(`'${node}' has no tap '${tap}'`);
  if (subchain !== null) {
    // Checked HERE, so a route to nowhere is refused with a reason rather than failing the next compile.
    const cp = readChainProject(dir);
    const at = cp.nodes[node];
    const parent = at ? cp.chains[at.chain] : undefined;
    if (!parent?.subchains?.some((s) => s.id === subchain))
      throw new Error(
        `'${subchain}' is not a subchain of ${at?.chain ?? "the node's"} chain file`,
      );
    if (calledSubchains(parent).has(subchain))
      throw new Error(
        `'${subchain}' is run in place as a step — a tap cannot feed it`,
      );
  }
  return editModuleFile(dir, node, (doc) => {
    if (subchain === null) doc.deleteIn(["tap_outs", tap], { prune: true });
    else if (doc.getNode(["tap_outs"])?.kind === "map")
      doc.setIn(["tap_outs", tap], subchain);
    // Made on one line: a node routes a handful of taps, `tap_outs: { SD: snare-fx }`.
    else doc.setIn(["tap_outs"], { [tap]: subchain }, { inline: true });
  });
}
