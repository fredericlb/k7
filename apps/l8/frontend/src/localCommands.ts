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
  // The command catalogue as this person arranges it: names, icons, menu order.
  "settings commands",
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
  // Reopens the take review on a clip — a VIEW, so `ui`. The panel's own buttons are the brain's.
  "review ",
  "midi learn ",
  "panel ",
  "surface ",
  "builder ",
  "language ",
  "pin ",
  "copy path ",
];

// `BARE_NAMES` was here: the tree's verbs, checked FIRST because `file new x` and `ui file x`
// differed only in their second token — one says what to DO to a file, the other names one to
// open — so without it the pairing rule answered every `file <verb>` with "type: ui file …".
// They are `fs file new`, `fs folder new` … now, and share a head with nothing: the group name
// does what the exception did, so the exception is gone.

/**
 * The transport verbs the shell answers over the ENGINE's socket instead of sending to the file
 * service — which would send this very message, after an HTTP round trip and the undo journal.
 *
 * They are NOT `ui` lines: `ui` promises not to move the transport, and these are the transport.
 * They are the catalogue's own verbs, dispatched here because the shortest path to the engine is
 * the socket the shell already holds — measured at ~110 ms through the service on an idle
 * machine, and up to a second and a half behind a project compile. See docs/shell.md.
 *
 * `transport metronome` is deliberately absent: it rewrites settings.yaml, so it is a real
 * command with a real edit. `locate`, `loop`, `record` and `replay` are answered here too, each
 * for its own reason, and their branches are in App.
 */
export const BARE_TRANSPORT: readonly string[] = [
  "transport play",
  "transport stop",
  "transport toggle",
  "transport rewind",
];

/**
 * Does `line` name this command? Whole-word: the name ends the line or is followed by a space.
 *
 * Both forms matter. `fs file new clips kick.yaml` is the line as run; a bare `fs file new` is what a
 * bar dispatches before its form is filled, and it has to reach the same branch — which answers
 * with a usage line rather than falling through to the backend as an unknown verb.
 */
export const namesLine = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name} `);

const heads = (line: string, names: readonly string[]): boolean =>
  names.some((n) => namesLine(line, n.trimEnd()));

/**
 * Does this line — already stripped of any `ui ` prefix, already lowercased — name a `ui`
 * command? One list of exact names, one of heads, and nothing to except: no bare-named command
 * shares a head with a `ui` one any more (see the note above BARE_NAMES's grave).
 */
export const isUiLine = (line: string): boolean =>
  UI_EXACT.includes(line) || heads(line, UI_HEADS);
