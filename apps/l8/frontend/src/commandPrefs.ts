// commandPrefs.ts — what a PERSON has made of the command catalogue: what each command is called
// on their screen, which icon it wears, and the order the menus list them in. The catalogue itself
// is the app's and is the same for everyone; this is the layer over it, and it is pure so the
// settings page and every menu apply it the same way.

/** One command's overrides. Every field optional — an untouched command has no entry at all. */
export interface CommandPref {
  /** What to call it. Empty or absent ⇒ the catalogue's own sentence, in the current locale. */
  label?: string;
  /** A lucide icon name, e.g. "Scissors". Absent ⇒ no icon; an unknown one draws nothing. */
  icon?: string;
  /** Where it sits in a menu. Absent ⇒ after everything ordered, in catalogue order. */
  order?: number;
  /** The key that runs it — a keyToken string ("g", "shift+space"), or keys.ts's KEY_NONE to
   *  take a default shortcut away without giving another. Absent ⇒ the app's own binding.
   *  Applied by `effectiveKeys` (keys.ts), which is where the change/steal rules live. */
  key?: string;
}

/**
 * Keyed by the CANONICAL line — `clip trim`, `ui help` — and never by what is displayed, which a
 * rename or a change of language moves.
 *
 * The canonical rather than the sid because it is the one id BOTH halves of the catalogue have:
 * the backend's commands carry a sid, the shell's own `ui …` lines do not, and a page that could
 * only arrange half of them would order a menu it does not draw.
 */
export type CommandPrefs = Record<string, CommandPref>;

/** The least a command has to have for this module to work on it — what PaletteCommand already is. */
export interface CommandLike {
  canonical: string;
  readable?: string;
}

/**
 * The ENTITY a command acts on: the first word of its line. `clip onset move` → "clip".
 *
 * The line already says it, so nothing new has to be authored and nothing can drift — a command
 * added to the app is filterable the day it exists. A one-word command is its own entity, which is
 * right for the handful that are verbs in themselves (`undo`, `redo`).
 */
export function entityOf(canonical: string): string {
  const head = canonical.trim().split(/\s+/)[0];
  return head || canonical;
}

/** Every entity present, in a stable order — what the page's filter offers. */
export function entitiesOf(commands: readonly CommandLike[]): string[] {
  return [...new Set(commands.map((c) => entityOf(c.canonical)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** What to CALL a command: the person's own name for it, else the catalogue's sentence, else the
 *  line itself — which is always something, so a menu never draws a blank row. */
export function labelOf(c: CommandLike, prefs: CommandPrefs): string {
  const own = prefs[c.canonical]?.label?.trim();
  return own || c.readable?.trim() || c.canonical;
}

/**
 * The catalogue as this person has arranged it: renamed, and in their order.
 *
 * Commands they have placed come first, by `order`; everything else follows in the order the
 * catalogue gave it. That rule is what lets someone pull three commands to the top without having
 * to number the other two hundred — the alternative, a total order, would mean every new command
 * in the app arriving at a position somebody's saved list had already decided.
 *
 * Stable within each group: two commands with the same `order` keep their catalogue order, so a
 * duplicated number is untidy rather than random.
 */
export function orderCommands<T extends CommandLike>(
  commands: readonly T[],
  prefs: CommandPrefs,
): T[] {
  return commands
    .map((c, i) => ({ c, i, order: prefs[c.canonical]?.order }))
    .sort((a, b) => {
      if (a.order === undefined && b.order === undefined) return a.i - b.i;
      if (a.order === undefined) return 1;
      if (b.order === undefined) return -1;
      return a.order - b.order || a.i - b.i;
    })
    .map((e) => e.c);
}

/**
 * Move `canonical` one place up or down, and answer the prefs that say so.
 *
 * It renumbers the WHOLE list it is given rather than nudging one entry, because "one place up"
 * is only meaningful against an arrangement: a list where most commands have no order has no
 * neighbour to swap with. The result is a complete order for that list, which is what the page
 * was showing anyway.
 */
export function moveCommand(
  commands: readonly CommandLike[],
  prefs: CommandPrefs,
  canonical: string,
  by: -1 | 1,
): CommandPrefs {
  const list = orderCommands(commands, prefs);
  const at = list.findIndex((c) => c.canonical === canonical);
  const to = at + by;
  if (at < 0 || to < 0 || to >= list.length) return prefs; // an end is an end
  const moved = [...list];
  [moved[at], moved[to]] = [moved[to], moved[at]];
  const next: CommandPrefs = { ...prefs };
  moved.forEach((c, i) => {
    next[c.canonical] = { ...next[c.canonical], order: i };
  });
  return next;
}

/** Set one field, dropping the entry entirely when nothing is left to say — so an override taken
 *  back leaves the document as it was rather than growing a row of empty objects. */
export function setCommandPref(
  prefs: CommandPrefs,
  canonical: string,
  patch: Partial<CommandPref>,
): CommandPrefs {
  const merged: CommandPref = { ...prefs[canonical], ...patch };
  for (const k of Object.keys(merged) as (keyof CommandPref)[])
    if (merged[k] === undefined || merged[k] === "") delete merged[k];
  const next = { ...prefs };
  if (Object.keys(merged).length) next[canonical] = merged;
  else delete next[canonical];
  return next;
}
