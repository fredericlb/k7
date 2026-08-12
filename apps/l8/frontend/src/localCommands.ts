// localCommands.ts — WHICH lines the shell answers itself, and under which namespace. The
// behaviours are App's `runLocalCommand`; what is here is only the table it reads, pulled out
// so a test can hold it against `LOCAL_COMMANDS` — a command in the palette that the
// dispatcher does not recognise is a row that lists, runs, and does nothing.

import { PANES } from "./shellMeta";

/**
 * `ui` promises: touches nothing of the PROJECT, does not move the transport. Everything under
 * it is the shell and its settings, and the pairing is enforced BOTH ways (see docs/shell.md) —
 * a `ui` command typed bare is refused, and so is a bare one typed with the prefix.
 */
export const UI_EXACT: readonly string[] = [
  "global",
  ...PANES,
  "focus next",
  "close",
  "popin close",
  "slot close",
  "select",
  "zoom",
  "zoom out",
  "zoom reset",
  "help",
  // The footer's own buttons, beside the panel row.
  "mixer",
  "notes",
  "logs clear",
  // The timeline header's two toggles.
  "ruler",
  "lanes",
  // The cog menu and the screen it opens.
  "settings editor",
  "settings io",
  "vim",
  "engine",
  "workspace quit",
  "logout",
];

/** The `ui` ones that take an argument, so they match on their head rather than whole. */
export const UI_HEADS: readonly string[] = [
  "file ",
  "edit sequence ",
  "edit clip ",
  "midi learn ",
  "panel ",
  "surface ",
  "builder ",
  "language ",
  "pin ",
  "copy path ",
];

/**
 * The bare-named ones that share a head with a `ui` command, checked FIRST.
 *
 * `file new x` and `ui file x` differ only in their second token: one says what to DO to a
 * file, the other names one to open. Without this the pairing rule would send every
 * `file <verb>` back with "type: ui file …".
 */
export const BARE_NAMES: readonly string[] = [
  "file new",
  "file rename",
  "file move",
  "file delete",
  "file upload",
  "folder new",
];

/**
 * Does `line` name this command? Whole-word: the name ends the line or is followed by a space.
 *
 * Both forms matter. `file new clips kick.yaml` is the line as run; a bare `file new` is what a
 * bar dispatches before its form is filled, and it has to reach the same branch — which answers
 * with a usage line rather than falling through to the backend as an unknown verb.
 */
export const namesLine = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name} `);

const heads = (line: string, names: readonly string[]): boolean =>
  names.some((n) => namesLine(line, n.trimEnd()));

/**
 * Does this line — already stripped of any `ui ` prefix, already lowercased — name a `ui`
 * command? A bare name wins, which is the whole point of checking it first.
 */
export const isUiLine = (line: string): boolean =>
  !heads(line, BARE_NAMES) &&
  (UI_EXACT.includes(line) || heads(line, UI_HEADS));
