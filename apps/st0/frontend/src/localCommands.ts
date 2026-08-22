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
  // `copy` was here, as the rectangle onto the shell's clipboard. It is `selection copy` now —
  // see the note above BARE_TRANSPORT. What is left under `ui` is `copy path <file>`, a head
  // below: the tree's verb, which puts a PATH on the system clipboard and is a different act.
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
  // The three RIGHT-HAND panels. Each bare line TOGGLES its own, which is what its button in
  // the bar does; one column, so opening any closes the others (see App's `rightPanel`).
  "settings",
  // The workspace's set lists — its own panel, because what it opens belongs to the REPOSITORY
  // and is a thing you work FROM rather than one you set. See docs/playlists.md.
  "playlists",
  // Commit, pull, export, publish. `ui` because the PANEL is a view; every verb inside it is a
  // `project` one and writes.
  "share",
  // …and the settings panel's tabs.
  "settings editor",
  "settings io",
  // Who you are, the engine, the workspace, the language — the old menu's top and bottom, which
  // were actions rather than a screen and now have a tab of their own.
  "settings account",
  // The command catalogue as this person arranges it: names, icons, menu order. The one that
  // is still a full PAGE — a catalogue is not orderable in a 24rem column.
  "settings commands",
  // `external <surface>` takes an argument, so it is a HEAD below rather than an exact — listed
  // here only in this comment, where somebody looking for it will be.
  // The library's chains, edited as the graphs they are — a screen of its own, so it is opened
  // the way `help` and the settings screens are rather than by a pane. See docs/chainsBuilder.md.
  "chains builder",
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
  // A surface's link, for another device — `ui external <surface>`. See docs/external.md.
  "external ",
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

// `selection copy` and `selection paste` are answered here too, and have no table of their own:
// App matches them by name, the way `transport locate` and `transport loop` are matched.
//
// They are NOT `ui` lines, and the pair had to move together. `copy` was under `ui` — the
// clipboard is the shell's and no file moves — while the paste WROTE and so was bare-named, which
// put one gesture's two halves on either side of the namespace line. `selection` answers it better
// than the write/no-write rule did: what they share is the region a gesture aimed at, and the head
// says so. `selection consolidate` is the catalogue's own, and joins them in the palette.

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
