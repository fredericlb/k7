// localCommands.ts — WHICH lines the shell answers itself, and under which namespace. The
// behaviours are App's `runLocalCommand`; what is here is only the table it reads, pulled out
// so a test can hold it against `LOCAL_COMMANDS` — a command in the palette that the
// dispatcher does not recognise is a row that lists, runs, and does nothing.

import { PANES } from "./shellMeta";

/** `ui` promises: touches nothing of the PROJECT, moves no transport — and the pairing is enforced BOTH ways (docs/shell.md). */
export const UI_EXACT: readonly string[] = [
  "global",
  ...PANES,
  "focus next",
  "close",
  "popin close",
  "slot close",
  "select",
  // `copy` was here; it is `selection copy` now, and what is left under `ui` is `copy path <file>`, the tree's own act.
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
  // The three RIGHT-HAND panels: each bare line TOGGLES its own, and one column means opening any closes the others.
  "settings",
  // The workspace's set lists — its own panel, since what it opens belongs to the REPOSITORY (docs/playlists.md).
  "playlists",
  // Commit, pull, export, publish. `ui` because the PANEL is a view; every verb inside it is a `project` one and writes.
  "share",
  // …and the settings panel's tabs.
  "settings editor",
  "settings io",
  // Who you are, the engine, the workspace, the language — the old menu's top and bottom, now a tab of their own.
  "settings account",
  // The command catalogue as this person arranges it — still a full PAGE, a catalogue not being orderable in a 24rem column.
  "settings commands",
  // The library's chains, edited as the graphs they are — a screen of its own (docs/chainsBuilder.md); `external <surface>` is a HEAD below.
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

// `BARE_NAMES` was here, for the tree's verbs; they are `fs file new` … now and share a head with nothing, so the exception is gone.

// `selection copy` and `selection paste` are matched by name in App rather than tabulated here — one head for the region a gesture aimed at.

/** The transport verbs the shell answers over the ENGINE's socket instead of the file service — measured at ~110 ms through it (docs/shell.md). */
export const BARE_TRANSPORT: readonly string[] = [
  "transport play",
  "transport stop",
  "transport toggle",
  "transport rewind",
];

/** Does `line` name this command? Whole-word, so a bare `fs file new` from an unfilled form reaches the same branch as the full line. */
export const namesLine = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name} `);

const heads = (line: string, names: readonly string[]): boolean =>
  names.some((n) => namesLine(line, n.trimEnd()));

/** Does this line — stripped of any `ui ` prefix and lowercased — name a `ui` command? One list of exact names, one of heads. */
export const isUiLine = (line: string): boolean =>
  UI_EXACT.includes(line) || heads(line, UI_HEADS);
