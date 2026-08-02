// palette.ts — the shell's own command catalogue for the palette, and per-argument
// completion. Extracted from App.tsx: everything here is a pure function of the
// backend's catalogue plus a `files()` getter, no shell state.

import { api } from "./api";
import {
  canonicalizeCommand,
  commandLabel,
  commandTranslations,
} from "./commandI18n";
import type { PaletteArg, PaletteCommand } from "./components/CommandBar";
import { fuzzyScore } from "./fuzzy";
import { ALL_PANES } from "./shellMeta";
import type { CommandInfo } from "./types";

// Everything whose ONLY effect is on the shell lives under `ui` — the namespace promises it writes no file and
// never moves the transport. `locate`, `loop`, `record`, `new/delete project` and `event move` keep bare names.
export const LOCAL_COMMANDS = [
  "ui file", // open a file in the editor by fuzzy name (completes against the project)
  "ui global", // the 3-pane view — the default, and what esc backs out to
  "ui video", // the same three panes with the renderer instead of the graph (video songs)
  ...ALL_PANES.map((p) => `ui ${p}`), // fullscreen one pane (viewport: a no-op without video)
  "ui focus next", // move the keys to the next pane (tab)
  "ui close", // close the bottom panel
  "project new", // scaffold a new project at the workspace root, then open it
  "project delete", // recycle a project folder (confirmed via a dialog)
  "ui edit sequence", // open a MIDI sequence's file in the editor
  "ui edit clip", // open an audio clip's file in the editor
  // The timeline's selection, zoom, loop and move: the state lives in TimelineTab and these reach it via its handle.
  "ui select", // caret <-> selection rectangle
  "ui zoom", // frame the selection
  "ui zoom out", // back to the enclosing view
  "ui zoom reset", // back to the whole song
  "transport locate", // move the playhead to the caret
  "transport loop", // set/clear the transport loop from the selection
  "transport record", // the global record enable (engine session state, over the wire)
  "event move", // pick up the clip under the caret and nudge it; commits to disk
  "ui help", // the `?` overlay: commands, keys, and the song-file syntax reference
];

// The trailing params for the shell's own commands; `kind` is what the param NAMES, and colours the field.
export const LOCAL_ARGS: Record<string, PaletteArg[]> = {
  "ui file": [{ name: "path", kind: "file", hint: "a file of this project" }],
  // `type` is the fixed audio|video choice completed below in makeCompleteArg.
  "project new": [
    { name: "type", kind: "choice", hint: "audio · video" },
    { name: "name", kind: "text", hint: "the new project's folder name" },
  ],
  "project delete": [
    { name: "name", kind: "text", hint: "a project of this workspace" },
  ],
  "ui edit sequence": [
    { name: "name", kind: "file", hint: "a sequence of this project" },
  ],
  "ui edit clip": [
    { name: "name", kind: "file", hint: "a clip of this project" },
  ],
};

/** The palette's full catalogue: the backend's commands plus the shell's own. */
export function buildPaletteCommands(
  backendCmds: CommandInfo[],
): PaletteCommand[] {
  const mk = (canonical: string, args: PaletteArg[]): PaletteCommand => ({
    canonical,
    label: commandLabel(canonical),
    names: commandTranslations(canonical),
    args,
  });
  const backend = backendCmds.map((c) => mk(c.command, c.args));
  const locals = LOCAL_COMMANDS.filter(
    (c) => !backendCmds.some((b) => b.command === c),
  ).map((c) => mk(c, LOCAL_ARGS[c] ?? []));
  return [...backend, ...locals];
}

/**
 * Completion for one param of a command, given the ones already filled. `file`'s path
 * completes against the open project's files (the `files` getter); everything else asks
 * the backend for the assembled line and lifts out the token at this position.
 */
export function makeCompleteArg(files: () => string[]) {
  return async (
    command: string,
    priorArgs: string[],
    partial: string,
  ): Promise<string[]> => {
    const canonical = canonicalizeCommand(command);
    // `new project`'s first arg is a fixed audio|video choice the backend knows nothing about, so offer it here.
    if (canonical === "new project" && priorArgs.length === 0)
      return ["audio", "video"].filter((t) =>
        t.startsWith(partial.toLowerCase()),
      );
    if (canonical === "file" && priorArgs.length === 0) {
      return files()
        .map((p) => ({ p, score: partial ? fuzzyScore(partial, p) : 0 }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))
        .slice(0, 8)
        .map((x) => x.p);
    }
    // The line MUST end with a space, even for an empty partial: that space is how `completions` tells "complete the
    // next argument" from "still typing a command name", and without it the palette offered commands, not values.
    const line = [canonical, ...priorArgs, partial].join(" ");
    const full = await api.complete(line).catch(() => [] as string[]);
    // `completions` answers with whole LINES, so strip the prefix we sent rather than indexing tokens: a command name
    // is often several words, and a fixed index handed back part of the COMMAND. It also keeps spaces in values.
    const prefix = `${[canonical, ...priorArgs].join(" ")} `;
    return [
      ...new Set(
        full
          .map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : ""))
          .filter((v) => v),
      ),
    ];
  };
}
