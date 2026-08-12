// moduleInsert.ts — what the graph's `+` types into the command bar.
//
// It used to take TWO commands: create the module, then splice it, sent as two HTTP calls with a full project
// recompile wasted between them. The only reason for the split was that the frontend had to learn the new
// module's name before it could name it in a chain — and `module insert` picks that name itself. One command,
// one round trip, one reload.
//
// The arrow goes FIRST in the line so the node name still lands last, where a person types it. That is the
// whole reason for the argument order.

/** The pending half of a `+` click: the arrow the module is being dropped onto. */
export interface PendingInsert {
  before: string;
  after: string;
}

/**
 * The name a chain's `use` step should name, given the command that just created the
 * module — or null when the line isn't one of the two creating commands.
 *
 * Both commands are positional, and both end in the module's FOLDER name plus an
 * optional node:
 *
 *   module new <type>/<name> [extends-ref] [node]   → "name" or "name:node"
 *   node new <type>/<name> <node>        → "name:node"
 *
 * A chain can name the bare module or one of its nodes, so `module new` without a
 * node is still insertable — it just names the generic.
 */
export function chainRefFromCreate(line: string): string | null {
  const parts = line.trim().split(/\s+/).filter(Boolean);

  // Two verbs, two words each — `node new` shares no prefix with `module new` since a node
  // stopped being spelled `module instance`, so neither can shadow the other.
  const nodeNew = parts[0] === "node" && parts[1] === "new";
  const moduleNew = parts[0] === "module" && parts[1] === "new";
  if (!nodeNew && !moduleNew) return null;

  const args = parts.slice(2);
  const target = args[0] ?? "";
  // "<type>/<name>" — the module's own folder. Anything else is a line the command itself rejects.
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  const name = segs[1];

  if (nodeNew) {
    const node = args[1];
    return node ? `${name}:${node}` : null;
  }
  // `module new` takes the node THIRD: with two args the second is the ref, so the chain names the generic.
  const node = args[2];
  return node ? `${name}:${node}` : name;
}

/**
 * The line the `+` pre-writes: everything the command needs except the node name, which the user types.
 * `ref` is the catalogue module to inherit, absent for a module of this project (which is used directly).
 */
export const moduleInsertCommand = (
  i: PendingInsert,
  type: string,
  name: string,
  ref?: string,
): string =>
  `module insert ${i.before} ${i.after} ${type}/${name}${ref ? ` ${ref}` : ""} `;

/**
 * The same line for a pick made on EMPTY canvas: no arrow, so the module lands in the graph wired to nothing.
 *
 * Same shape and same tail as the insert — the node name is still the last thing, still missing, still
 * where the cursor stops. Only the verb and the two node names differ, so the two lines read as one gesture
 * with and without a target.
 */
export const modulePlaceCommand = (
  type: string,
  name: string,
  ref?: string,
): string => `module place ${type}/${name}${ref ? ` ${ref}` : ""} `;
