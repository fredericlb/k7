// moduleInsert.ts — what the graph's `+` types into the command bar.
//
// It used to take TWO commands: create the module, then splice it, sent as two HTTP calls with a full project
// recompile wasted between them. The only reason for the split was that the frontend had to learn the new
// module's name before it could name it in a chain — and `module insert` picks that name itself. One command,
// one round trip, one reload.
//
// The arrow goes FIRST in the line so the instance name still lands last, where a person types it. That is the
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
 * optional instance:
 *
 *   module new <type>/<name> [extends-ref] [instance]   → "name" or "name:instance"
 *   module instance new <type>/<name> <instance>        → "name:instance"
 *
 * A chain can name the bare module or one of its instances, so `module new` without an
 * instance is still insertable — it just names the generic.
 */
export function chainRefFromCreate(line: string): string | null {
  const parts = line.trim().split(/\s+/).filter(Boolean);

  // Longest command prefix first: "module instance new" also starts with "module".
  const instanceNew =
    parts[0] === "module" && parts[1] === "instance" && parts[2] === "new";
  const moduleNew = !instanceNew && parts[0] === "module" && parts[1] === "new";
  if (!instanceNew && !moduleNew) return null;

  const args = parts.slice(instanceNew ? 3 : 2);
  const target = args[0] ?? "";
  // "<type>/<name>" — the module's own folder. Anything else is a line the command itself rejects.
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  const name = segs[1];

  if (instanceNew) {
    const instance = args[1];
    return instance ? `${name}:${instance}` : null;
  }
  // `module new` takes the instance THIRD: with two args the second is the ref, so the chain names the generic.
  const instance = args[2];
  return instance ? `${name}:${instance}` : name;
}

/**
 * The line the `+` pre-writes: everything the command needs except the instance name, which the user types.
 * `ref` is the catalogue module to inherit, absent for a module of this project (which is instanced directly).
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
 * Same shape and same tail as the insert — the instance name is still the last thing, still missing, still
 * where the cursor stops. Only the verb and the two node names differ, so the two lines read as one gesture
 * with and without a target.
 */
export const modulePlaceCommand = (
  type: string,
  name: string,
  ref?: string,
): string => `module place ${type}/${name}${ref ? ` ${ref}` : ""} `;
