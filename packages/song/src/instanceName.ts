// instanceName.ts — how a thing this project makes is named after what it came from:
// `<owner>_<what>_<n>`. Pure, no disk, so the browser can propose a name the service will accept.
//
// The rule existed twice over before it existed once: `moduleFork` minted `bs_lead_tape-delay_1`
// for a copy of a shared module, and a node had no rule at all — a person typed its name into
// the command bar. Both are the same question ("what do I call this use of that"), and a rule
// spelled in two places is two answers. See docs/nodes.md.

/**
 * One segment the module vocabulary accepts — `createNode` and `createModuleFile` both refuse
 * anything else, and a lane is called `vo.jo`, so this is not cosmetic.
 *
 * `"x"` for a name that survives as nothing at all: an empty segment would make `_1` the whole
 * name, which is a file called nothing.
 */
export const namePart = (s: string): string =>
  s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";

/**
 * The first free `<owner>_<what>_<n>`, counting from 1.
 *
 * `owner` is what the thing is FOR — the lane whose chain will play it — and it is dropped when
 * there is none: a module the project does not play yet, a node dropped on the bare canvas.
 * `4osc_1` rather than `_4osc_1`, which is the shape `moduleFork` already answered with.
 *
 * The increment is always written, including on the first. Two reasons, and the second is the
 * one that matters: `vo_reverb` and `vo_reverb_2` would read as different KINDS of thing rather
 * than as the first and second of a series, and a name that has to be renamed to make room for a
 * sibling is a name that breaks every chain that spelled it.
 *
 * `taken` is injected rather than read here so this file touches no disk: the service asks the
 * project, the browser asks the graph it is drawing.
 */
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

/**
 * What a use should be CALLED once the thing under it changes — or null when its name is not one
 * this convention made, in which case a person chose it and it is not ours to move.
 *
 * That null is the whole point. `node replace` swaps the module a node extends, and a node still
 * wearing `vo_jo_reverb_1` while it extends a delay is a name that lies — but one somebody
 * deliberately called `wash` means `wash`, and renaming it would rewrite every chain that spells
 * it to undo a decision.
 *
 * BOTH shapes count as ours, and the one that matched is the one that comes back: a node born on
 * the bare canvas is `reverb_1` with no lane in it, and it keeps having none after it is spliced
 * into a run. Following the module it names is what was asked for; growing a prefix it never had
 * would be a second change nobody asked for.
 *
 * The counter is NOT carried over — `instanceName` picks the first free one for the new stem.
 * `vo_jo_reverb_2` becoming `vo_jo_delay_1` looks like a step backwards and is not: the number
 * counts uses of THAT module, and there is one of the new one.
 */
export function renamedInstance(
  name: string,
  from: string,
  to: string,
  owner: string | null | undefined,
  taken: (name: string) => boolean,
): string | null {
  const what = namePart(from);
  // The module's NAME is what a use is called after, so two modules that clean to the same word
  // leave nothing to follow. Without this, replacing a module with itself would walk the counter
  // up by one every time and rewrite the chains to say nothing.
  if (what === namePart(to)) return null;
  if (owner && madeFrom(name, `${namePart(owner)}_${what}`))
    return instanceName(to, owner, taken);
  if (madeFrom(name, what)) return instanceName(to, null, taken);
  return null;
}
