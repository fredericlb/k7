// nodeInsert.ts — what the graph's `+` types into the command bar.
//
// It used to take TWO commands: create the module, then splice it, sent as two HTTP calls with a full project
// recompile wasted between them. The only reason for the split was that the frontend had to learn the new
// module's name before it could name it in a chain — and `node insert` picks that name itself. One command,
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
 * What a chain should NAME, given the creating command that just ran — or null when the line is
 * not one.
 *
 * One command answers now: `node new <type>/<name> <node>` → the node. It used to be two, because
 * `module new` took a trailing node name and made one; it writes a module and nothing else, so
 * there is no node to read off it.
 *
 * A node is named by its FILE alone — `nodes/<node>.yaml` — so what comes back is that name and
 * nothing about the module behind it.
 */
export function chainRefFromCreate(line: string): string | null {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  if (parts[0] !== "node" || parts[1] !== "new") return null;
  const args = parts.slice(2);
  // "<type>/<name>" — the module's own folder. Anything else is a line the command rejects.
  const segs = (args[0] ?? "").split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1]) return null;
  return args[1] ?? null;
}

/**
 * The line the `+` pre-writes: the NODE to create, missing only the name the user types.
 *
 * `node new` — not `module new`, which stopped making nodes. That is the whole gesture for a
 * module this project already has: one line, and the node lands in the graph because `node new`
 * puts it there.
 */
export const createForGraphCommand = (type: string, name: string): string =>
  `node new ${type}/${name} `;

/**
 * …and the line that has to run BEFORE it, or null.
 *
 * `node new` instances a module that EXISTS — locally, or offered by the engine. A pick from a
 * catalogue has neither yet, so its local folder is written first, inheriting the ref. Absent for
 * a module of this project, which is the common case and stays one command.
 */
export const ensureModuleCommand = (
  type: string,
  name: string,
  ref?: string,
): string | null => (ref ? `module new ${type}/${name} ${ref}` : null);

/**
 * Where the node that line makes should GO, once it exists — or null when there is nothing left
 * to say.
 *
 * On an ARROW it is a splice, and that is a real second act. On the bare canvas it is not: the
 * node is already in the graph, because `node new` put it there. All that is left is the pin, and
 * only when the pick carried a point — without one the layout answers, which is the right answer.
 *
 * `node place` did the bare-canvas half until both of its reasons went away (see the note where
 * it was declared). `graph move` takes x and y as SEPARATE words, not the comma pair the
 * spawn token uses.
 */
export const wireCommand = (
  ref: string,
  at: PendingInsert | null,
  spawn?: { x: number; y: number } | null,
): string | null => {
  const x = spawn ? Math.round(spawn.x) : 0;
  const y = spawn ? Math.round(spawn.y) : 0;
  if (at)
    return `node insert ${at.before} ${at.after} ${ref}${spawn ? ` ${x},${y}` : ""}`;
  return spawn ? `graph move ${ref} ${x} ${y}` : null;
};
