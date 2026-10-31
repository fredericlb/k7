// serverEngines.ts — one list from a machine's own registry and the engines its main server lists, the pure half:
// which entry is reached through the server, and the merge. The rest is `access.ts`'s `server` option.
// The one thing a reader would get wrong: an engine listed by both is the LOCAL one, never twice. See docs/access.md.

/** What marks an engine as reached through another server's relay rather than this origin's. */
export interface ThroughServer {
  id: string;
  via?: { origin: string };
}

/** Whether this engine is driven through the server named by its `via`. */
export const isThroughServer = (e: ThroughServer): boolean => !!e.via?.origin;

/** This origin's engines first, then the server's not already among them: the same id is the local route. */
export function mergeEngines<E extends ThroughServer>(
  near: readonly E[],
  far: readonly E[],
): E[] {
  const here = new Set(near.map((e) => e.id));
  const seen = new Set<string>();
  const extra = far.filter((e) => {
    if (!isThroughServer(e) || here.has(e.id) || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  return [...near, ...extra];
}
