// instanceName.ts — how a thing this project makes is named after what it came from:
// `<owner>_<what>_<n>`. Pure, no disk, so the browser can propose a name the service will accept.
//
// Copying a shared module and naming a node are the same question ("what do I call this use of
// that"), so they share one rule: spelled in two places, it would be two answers. See docs/nodes.md.

/** One segment the module vocabulary accepts, `"x"` for a name that survives as nothing (docs/names.md). */
export const namePart = (s: string): string =>
  s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";

/** The first free `<owner>_<what>_<n>`, counting from 1 and ALWAYS numbered — see docs/names.md. */
export function instanceName(
  what: string,
  owner: string | null | undefined,
  taken: (name: string) => boolean,
): string {
  const stem = owner ? `${namePart(owner)}_${namePart(what)}` : namePart(what);
  let n = 1;
  while (taken(`${stem}_${n}`)) n++;
  return `${stem}_${n}`;
}

/** Is `name` `<stem>_<digits>` — a name this convention could have made from that stem? */
const madeFrom = (name: string, stem: string): boolean =>
  name.startsWith(`${stem}_`) && /^\d+$/.test(name.slice(stem.length + 1));

/** What a use should be CALLED once the thing under it changes, or NULL for a name a person chose (docs/names.md). */
export function renamedInstance(
  name: string,
  from: string,
  to: string,
  owner: string | null | undefined,
  taken: (name: string) => boolean,
): string | null {
  const what = namePart(from);
  // Two modules that clean to the same word leave nothing to follow (docs/names.md).
  if (what === namePart(to)) return null;
  if (owner && madeFrom(name, `${namePart(owner)}_${what}`))
    return instanceName(to, owner, taken);
  if (madeFrom(name, what)) return instanceName(to, null, taken);
  return null;
}
