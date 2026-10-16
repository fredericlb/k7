// commandPrefs.ts — what a PERSON has made of the command catalogue: what each command is called
// on their screen, which icon it wears, and the order the menus list them in. The catalogue itself
// is the app's and is the same for everyone; this is the layer over it, and it is pure so the
// settings page and every menu apply it the same way.

import type { MenuEntity } from "./types";

/** What a person calls a command, per language; a bare string is the legacy shape and stands for every locale until that command is next edited. */
export type CommandLabel = string | Record<string, string>;

/** Where a right-click may offer a command: a list of entities, `false` for nowhere at all. */
export type MenuChoice = boolean | MenuEntity[];

/** One command's overrides. Every field optional — an untouched command has no entry at all. */
export interface CommandPref {
  /** What to call it, in each language — per locale, because a rename is a SENTENCE and a sentence is translated. */
  label?: CommandLabel;
  /** A lucide icon name, e.g. "Scissors". Absent ⇒ no icon; an unknown one draws nothing. */
  icon?: string;
  /** Where it sits in a menu. Absent ⇒ after everything ordered, in catalogue order. */
  order?: number;
  /** The key that runs it, or KEY_NONE to take a default away; absent ⇒ the app's own binding (`effectiveKeys` in keys.ts). */
  key?: string;
  /** Which right-clicks may offer it, replacing the catalogue's own list; `false` is none. Absent ⇒ the catalogue's word. */
  menu?: MenuChoice;
}

/** Keyed by the CANONICAL line and never by what is displayed — the one id BOTH halves of the catalogue have. */
export type CommandPrefs = Record<string, CommandPref>;

/** The least a command has to have for this module to work on it — what PaletteCommand already is. */
export interface CommandLike {
  canonical: string;
  readable?: string;
}

/** A person's name for a command in ONE locale, AS AUTHORED — never trimmed here, which is what broke the space bar on the settings page. */
export function labelIn(
  label: CommandLabel | undefined,
  locale: string,
): string {
  if (label === undefined) return "";
  return typeof label === "string" ? label : (label[locale] ?? "");
}

/** The ENTITY a command acts on: the first word of its line, so nothing has to be authored and nothing can drift. */
export function entityOf(canonical: string): string {
  const head = canonical.trim().split(/\s+/)[0];
  return head || canonical;
}

/** Every head a catalogue uses, for the plural fold below. */
const headsOf = (commands: readonly CommandLike[]): Set<string> =>
  new Set(commands.map((c) => entityOf(c.canonical)));

/** The entity a command is LISTED under: its head, folded to the singular when the singular is a head too, and derived rather than tabulated. */
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

/** What to CALL a command: this person's name in THIS locale, else the catalogue's sentence, else the line — never a blank row. */
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

/** Which entities a command is offered on as things stand — null meaning "wherever it fits", which is the default. */
export function menuChoice(
  pref: CommandPref | undefined,
  catalogue: readonly MenuEntity[] | undefined,
): readonly MenuEntity[] | null {
  const own = pref?.menu;
  if (own === false) return [];
  if (Array.isArray(own)) return own;
  // `true` is the person overriding a catalogue restriction back to "everywhere" — see CommandsSettings.
  return own === true ? null : (catalogue ?? null);
}

/** May a right-click on `entity` offer `canonical`? It takes the LINE, so the menu's hand-written entries obey too. */
export function inMenu(
  canonical: string,
  prefs: CommandPrefs,
  entity?: MenuEntity,
  catalogue?: readonly MenuEntity[],
): boolean {
  const allowed = menuChoice(prefs[canonical], catalogue);
  if (!allowed) return true;
  // No entity named — the caller is asking whether ANY menu offers it, which is the settings page's question.
  return entity ? allowed.includes(entity) : allowed.length > 0;
}

/** The catalogue as this person has arranged it: placed commands first by `order`, the rest in catalogue order, stable within each group. */
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

/** Move `canonical` one place up or down: it renumbers the WHOLE list, 'one place up' being meaningful only against an arrangement. */
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

/** Set one field, dropping the entry when nothing is left to say — so an override taken back leaves no empty object behind. */
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

/** Say where a right-click may offer a command, in the SPELLING that says the least — docs/contextMenu.md. */
export function setMenuEntities(
  prefs: CommandPrefs,
  canonical: string,
  catalogue: readonly MenuEntity[] | undefined,
  next: readonly MenuEntity[],
  all: readonly MenuEntity[],
): CommandPrefs {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  const menu: MenuChoice | undefined = !next.length
    ? false
    : same(next, catalogue ?? all)
      ? undefined
      : same(next, all)
        ? true
        : [...next];
  // `undefined` would be DELETED by setCommandPref, which is exactly what "back to the catalogue's word" means.
  return setCommandPref(prefs, canonical, { menu });
}

/** Name a command in ONE language, leaving the others: a legacy bare string is EXPANDED across `locales` first, or the rest would be dropped. */
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
