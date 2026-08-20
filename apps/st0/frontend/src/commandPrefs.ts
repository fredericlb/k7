// commandPrefs.ts — what a PERSON has made of the command catalogue: what each command is called
// on their screen, which icon it wears, and the order the menus list them in. The catalogue itself
// is the app's and is the same for everyone; this is the layer over it, and it is pure so the
// settings page and every menu apply it the same way.

/**
 * What a person calls a command, per language: `{ en: "Trim", fr: "Rogner" }`.
 *
 * A bare string is what this field USED to be, and is still read — it was written when there was
 * one field and no language attached to it, so it stands for every locale at once. Nothing
 * rewrites it on load: a document is migrated when the person next edits that command, and until
 * then it keeps saying what it always said.
 */
export type CommandLabel = string | Record<string, string>;

/** One command's overrides. Every field optional — an untouched command has no entry at all. */
export interface CommandPref {
  /**
   * What to call it, in each language. Empty or absent for a locale ⇒ the catalogue's own
   * sentence in that locale.
   *
   * Per locale and not one string, because a rename is a SENTENCE and a sentence is translated —
   * the command's name stays the CLI's in every language (see CommandInfo.readable, which splits
   * the two for the same reason). One field meant renaming while reading French also renamed
   * what English showed, with nothing on screen saying so.
   */
  label?: CommandLabel;
  /** A lucide icon name, e.g. "Scissors". Absent ⇒ no icon; an unknown one draws nothing. */
  icon?: string;
  /** Where it sits in a menu. Absent ⇒ after everything ordered, in catalogue order. */
  order?: number;
  /** The key that runs it — a keyToken string ("g", "shift+space"), or keys.ts's KEY_NONE to
   *  take a default shortcut away without giving another. Absent ⇒ the app's own binding.
   *  Applied by `effectiveKeys` (keys.ts), which is where the change/steal rules live. */
  key?: string;
  /**
   * Whether a right-click may offer it. Absent ⇒ yes, which is what the menu did before this
   * existed.
   *
   * Only ever a way to take one AWAY. The menu is DERIVED — what you clicked says which type it
   * answers for, and every command whose leading arguments are exactly that is offered
   * (contextMenu.ts) — so this cannot add a command the click does not fit, and `true` is
   * therefore never worth storing. What it is for is the verb that fits and is still noise on
   * that menu, which the catalogue has no way to say: it describes arguments, not appetite.
   */
  menu?: boolean;
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
 * A person's name for a command in ONE locale, AS AUTHORED, or "" when they have not given one.
 *
 * A legacy bare string answers for every locale, which is what it meant when it was the only
 * field. No fallback BETWEEN locales otherwise: a command named only in French shows the
 * catalogue's English sentence in English, which is the whole point of a field per language.
 *
 * It used to trim, and that broke the SPACE BAR on the settings page. This is the value of a
 * CONTROLLED input: typing "Rogner" then a space held "Rogner " in state and rendered "Rogner"
 * back into the field, so the space disappeared as it was typed and a two-word name could not be
 * entered at all. Trimming belongs where a name is DISPLAYED — `labelOf`, the context menu — and
 * never where one is being typed.
 */
export function labelIn(
  label: CommandLabel | undefined,
  locale: string,
): string {
  if (label === undefined) return "";
  return typeof label === "string" ? label : (label[locale] ?? "");
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

/** Every head a catalogue uses, for the plural fold below. */
const headsOf = (commands: readonly CommandLike[]): Set<string> =>
  new Set(commands.map((c) => entityOf(c.canonical)));

/**
 * The entity a command is LISTED under: its head, folded to the singular when the singular is
 * a head too. `events move` belongs with `event add` and `event remove`.
 *
 * A plural is the same subject taken several at a time, not another subject — so a group of its
 * own, holding one command, said nothing the singular's group did not, and hid it from the only
 * filter anyone would look under. Derived from the catalogue rather than tabulated: the day a
 * second plural verb is written it folds on its own, and a plural with no singular (nothing has
 * one today) keeps its own group rather than inventing a subject nobody wrote.
 */
export function entityGroup(
  canonical: string,
  heads: ReadonlySet<string>,
): string {
  const head = entityOf(canonical);
  const singular = head.endsWith("s") ? head.slice(0, -1) : "";
  return singular && heads.has(singular) ? singular : head;
}

/** Is this command the PLURAL one of its group — the one that acts on several at once? */
export function isPluralCommand(
  canonical: string,
  heads: ReadonlySet<string>,
): boolean {
  return entityOf(canonical) !== entityGroup(canonical, heads);
}

/** Every entity present, in a stable order — what the page's filter offers, plurals folded in. */
export function entitiesOf(commands: readonly CommandLike[]): string[] {
  const heads = headsOf(commands);
  return [
    ...new Set(commands.map((c) => entityGroup(c.canonical, heads))),
  ].sort((a, b) => a.localeCompare(b));
}

/** The heads a page needs to fold and to badge — computed once, handed to both. */
export const commandHeads = headsOf;

/**
 * What to CALL a command: the person's own name for it IN THIS LOCALE, else the catalogue's
 * sentence, else the line itself — which is always something, so a menu never draws a blank row.
 *
 * `c.readable` is already resolved to the locale by `buildPaletteCommands`, so the locale is
 * needed here only to pick the override — the two halves are chosen in the same language.
 */
export function labelOf(
  c: CommandLike,
  prefs: CommandPrefs,
  locale: string,
): string {
  return (
    // Trimmed HERE and not in `labelIn`, which answers the settings field — see its header.
    labelIn(prefs[c.canonical]?.label, locale).trim() ||
    c.readable?.trim() ||
    c.canonical
  );
}

/**
 * May a right-click offer `canonical`? Absent ⇒ yes — see `CommandPref.menu`.
 *
 * Takes the LINE rather than a CommandLike, because the context menu also builds entries the
 * catalogue does not hold (`ui file` on a lane, `track mute` on a group), and a person turning
 * one of those off should have it obey too.
 */
export function inMenu(canonical: string, prefs: CommandPrefs): boolean {
  return prefs[canonical]?.menu !== false;
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

/**
 * Name a command in ONE language, leaving the others as they were.
 *
 * `locales` is taken rather than assumed because of the legacy shape: a bare string was one name
 * standing for every language, so the first per-language edit EXPANDS it across `locales` before
 * setting the one being typed in. Without that, renaming in French would silently drop the name
 * English had been showing all along — the person would have to notice by switching language.
 *
 * A field emptied is an override taken back, not a blank name: the entry goes, and with it the
 * whole `label` once no language names the command any more.
 */
export function setCommandLabel(
  prefs: CommandPrefs,
  canonical: string,
  locale: string,
  text: string,
  locales: readonly string[],
): CommandPrefs {
  const current = prefs[canonical]?.label;
  const byLocale: Record<string, string> =
    typeof current === "string"
      ? Object.fromEntries(locales.map((l) => [l, current]))
      : { ...current };
  byLocale[locale] = text;
  for (const [l, v] of Object.entries(byLocale))
    if (!v.trim()) delete byLocale[l];
  return setCommandPref(prefs, canonical, {
    label: Object.keys(byLocale).length ? byLocale : undefined,
  });
}
