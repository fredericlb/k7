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
  // No bare `copy` here: copying a selection is `selection copy`, and the only `ui` one is `copy path <file>`, the tree's own act.
  "zoom",
  "zoom out",
  "zoom reset",
  "help",
  // The footer's own buttons, beside the panel row.
  "mixer",
  "stack",
  "notes",
  "logs clear",
  // The timeline header's toggles.
  "ruler",
  "lanes",
  "automation",
  // The per-track view's toggle: its curve cards shown, beside the cards they drive.
  "curves",
  // The RIGHT-HAND panels: each bare line TOGGLES its own, and one column means opening any closes the others.
  "settings",
  // The workspace's set lists — its own panel, since what it opens belongs to the REPOSITORY (docs/playlists.md).
  "playlists",
  // …and what you listen AGAINST, which belongs to the repository the same way (docs/references.md).
  "references",
  // …and the workspace's task list, TODOS.md at its root (docs/tasks.md).
  "tasks",
  // …and the open song's history, the undo journal and its commits as one list (docs/shell.md).
  "history",
  // Commit, pull, export, publish. `ui` because the PANEL is a view; every verb inside it is a `project` one and writes.
  "share",
  // …and the settings panel's tabs.
  "settings editor",
  "settings io",
  // What the open song says about its whole mix — its console (packages/song/docs/console.md).
  "settings project",
  // Who you are, the engine, the workspace, the language — one tab of their own.
  "settings account",
  // The command catalogue as this person arranges it — a full PAGE, a catalogue not being orderable in a 24rem column.
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
  // …and arming a PICTURE lane, which is the browser's the way MIDI learn is. Bare, it disarms.
  "picture arm ",
  // Which TOOL the active surface is holding — session state, so `ui`: it touches neither the project nor the transport.
  "tool ",
  // …and the same for the audio clip's waveform, whose three views ARE its three gestures (waveMode.ts).
  "wave ",
  // …and the piano roll's three: select, create, remove (rollMode.ts).
  "roll ",
  "panel ",
  "surface ",
  // A surface's link, for another device — `ui external <surface>`. See docs/external.md.
  "external ",
  "builder ",
  // An assembly TEMPLATE in the builder, by the ref a box names — packages/song/docs/assemblies.md.
  "assembly ",
  "language ",
  "pin ",
  "copy path ",
  // A node's MODEL, fetched from its module's `model_url` — the right-click's "Download model", followed on the status line.
  "model ",
  // The curve editor — bare on a NEW curve, with a name on that one (docs/curveEditor.md).
  "curve ",
  // …and on the curve a control follows, or a new one bound to it — a widget's right-click.
  "automate ",
  // A tap's own chain, in a popin — a pad's right-click (docs/shell.md).
  "tap chain ",
];

// The tree's verbs are `fs file new` … and share a head with nothing, so no list of bare names is needed here.

// `selection copy` and `selection paste` are matched by name in App rather than tabulated here — one head for the region a gesture aimed at.

/** The transport verbs the shell answers over the ENGINE's socket instead of the file service — measured at ~110 ms through it (docs/shell.md). */
export const BARE_TRANSPORT: readonly string[] = [
  "transport play",
  "transport stop",
  "transport toggle",
  "transport rewind",
  // Panic goes the same way, and for a sharper reason: it is what you type when the sound will not
  // stop, and the file service is the slow road exactly when something is wedged.
  "transport panic",
];

/** Does `line` name this command? Whole-word, so a bare `fs file new` from an unfilled form reaches the same branch as the full line. */
export const namesLine = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name} `);

const heads = (line: string, names: readonly string[]): boolean =>
  names.some((n) => namesLine(line, n.trimEnd()));

/** Does this line — stripped of any `ui ` prefix and lowercased — name a `ui` command? One list of exact names, one of heads. */
export const isUiLine = (line: string): boolean =>
  UI_EXACT.includes(line) || heads(line, UI_HEADS);

/**
 * Who answers a line: the shell's `ui` handlers, a refusal for a prefix on the wrong side, or the
 * caller's other paths (`pass`). An UNPREFIXED line the server's catalogue names is the server's even
 * when it shares a word with a `ui` head — `curve set` is not `ui curve set`. See docs/shell.md.
 */
export function uiVerdict(
  line: string,
  prefixed: boolean,
  isServerCommand: (line: string) => boolean,
): "ui" | "refuse" | "pass" {
  const ui = isUiLine(line);
  if (prefixed) return ui ? "ui" : "refuse";
  if (!ui) return "pass";
  return isServerCommand(line) ? "pass" : "refuse";
}
