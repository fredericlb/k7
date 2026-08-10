// palette.ts — the shell's own command catalogue for the palette, its readable
// descriptions, the fuzzy ranking the bar lists by, and each argument's vocabulary.
// Extracted from App.tsx: everything here is a pure function of the backend's catalogue
// plus a `files()` getter, no shell state. See docs/commandBar.md.

import { api } from "./api";
import {
  canonicalizeCommand,
  commandLabel,
  commandTranslations,
} from "./commandI18n";
import type { PaletteArg, PaletteCommand } from "./components/CommandBar";
import { fuzzyScore } from "./fuzzy";
import { MAX_RECENT } from "./recentCommands";
import { PANES } from "./shellMeta";
import type { CommandInfo } from "./types";

// Everything whose ONLY effect is on the shell lives under `ui` — the namespace promises it writes no file and
// never moves the transport. `locate`, `loop`, `record`, `new/delete project` and `event move` keep bare names.
export const LOCAL_COMMANDS = [
  "ui file", // open a file in the editor by fuzzy name (completes against the project)
  "ui global", // the 3-pane view — the default, and the only one since picture left for v1
  ...PANES.map((p) => `ui ${p}`), // fullscreen one pane
  "ui focus next", // move the keys to the next pane (tab)
  "ui close", // close the bottom panel
  "project new", // scaffold a new project at the workspace root, then open it
  "project delete", // recycle a project folder (confirmed via a dialog)
  "ui edit sequence", // open a MIDI sequence's file in the editor
  "ui edit clip", // open an audio clip's file in the editor
  // Arm MIDI learn on a module's param: the next control change from any attached controller
  // binds to it, and the binding is then written by `module cc`. A UI command because the
  // LISTENING is the browser's; the map it ends up writing is the brain's.
  "ui midi learn",
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

/**
 * What the shell's OWN commands do, as a sentence, in each language.
 *
 * The backend's 69 carry theirs in `commands.yaml`; these nineteen exist only in this app, so
 * this is their catalogue entry. Same rules: imperative, no example, no full stop — the palette
 * lists them side by side and a reader cannot tell which half a row came from, nor should they.
 */
export const LOCAL_READABLE: Record<string, { en: string; fr: string }> = {
  "ui file": {
    en: "Open a file of this project in the editor",
    fr: "Ouvrir un fichier de ce projet dans l'éditeur",
  },
  "ui global": {
    en: "Show the timeline and the chains together",
    fr: "Afficher la timeline et les chaînes ensemble",
  },
  "ui editor": {
    en: "Fullscreen the editor",
    fr: "Passer l'éditeur en plein écran",
  },
  "ui timeline": {
    en: "Fullscreen the timeline",
    fr: "Passer la timeline en plein écran",
  },
  "ui chains": {
    en: "Fullscreen the chains graph",
    fr: "Passer le graphe des chaînes en plein écran",
  },
  "ui focus next": {
    en: "Move the keyboard to the next pane",
    fr: "Donner le clavier au panneau suivant",
  },
  "ui close": {
    en: "Close the bottom panel",
    fr: "Fermer le panneau du bas",
  },
  "project new": { en: "Create a new project", fr: "Créer un nouveau projet" },
  "project delete": { en: "Delete a project", fr: "Supprimer un projet" },
  "ui edit sequence": {
    en: "Open a MIDI sequence in the editor",
    fr: "Ouvrir une séquence MIDI dans l'éditeur",
  },
  "ui edit clip": {
    en: "Open an audio clip's file in the editor",
    fr: "Ouvrir le fichier d'un clip audio dans l'éditeur",
  },
  "ui midi learn": {
    en: "Learn a MIDI control for a module's parameter",
    fr: "Apprendre un contrôle MIDI pour un paramètre de module",
  },
  "ui select": {
    en: "Switch between the caret and a selection",
    fr: "Basculer entre le curseur et une sélection",
  },
  "ui zoom": {
    en: "Frame the timeline on the selection",
    fr: "Cadrer la timeline sur la sélection",
  },
  "ui zoom out": {
    en: "Zoom back out one step",
    fr: "Revenir d'un cran en arrière",
  },
  "ui zoom reset": {
    en: "Show the whole song",
    fr: "Afficher tout le morceau",
  },
  "transport locate": {
    en: "Move the playhead to the caret",
    fr: "Placer la tête de lecture sur le curseur",
  },
  "transport loop": {
    en: "Loop the selection, or clear the loop",
    fr: "Boucler la sélection, ou annuler la boucle",
  },
  "transport record": {
    en: "Turn the global record enable on or off",
    fr: "Activer ou désactiver l'enregistrement global",
  },
  // Also in the backend's catalogue, and filtered out of the list when it is reachable. Kept
  // here so the row is still described when it is not — an undescribed row is an unfindable one.
  "event move": {
    en: "Move a clip to another position or track",
    fr: "Déplacer un clip à une autre position ou piste",
  },
  "ui help": {
    en: "Show the help: commands, keys and file syntax",
    fr: "Afficher l'aide : commandes, touches et syntaxe des fichiers",
  },
};

// The trailing params for the shell's own commands; `kind` is what the param NAMES, and colours the field
export const LOCAL_ARGS: Record<string, PaletteArg[]> = {
  "ui file": [{ name: "path", kind: "file", hint: "a file of this project" }],
  // `type` is the fixed audio|m9|v1 choice completed below in makeCompleteArg.
  "project new": [
    { name: "type", kind: "choice", hint: "audio · m9 · v1" },
    { name: "name", kind: "text", hint: "the new project's folder name" },
  ],
  "project delete": [
    { name: "name", kind: "text", hint: "a project of this workspace" },
  ],
  "ui edit sequence": [
    { name: "name", kind: "file", hint: "a sequence of this project" },
  ],
  "ui midi learn": [
    { name: "module", kind: "module", hint: "a module of this project" },
    { name: "param", kind: "text", hint: "the name its widget binds" },
  ],
  "ui edit clip": [
    { name: "name", kind: "file", hint: "a clip of this project" },
  ],
};

/**
 * The palette's full catalogue: the backend's commands plus the shell's own.
 *
 * `locale` resolves each description ONCE, here, so the bar holds a sentence and not a table to
 * choose from — matching, listing and the popin's title all read the same string, and a command
 * whose language changed simply arrives as a new catalogue.
 *
 * A command with no description falls back to its own name. That is a catalogue bug (the
 * commands package fails its tests without one), and showing the name is how it stays visible
 * rather than becoming an unfindable blank row.
 */
export function buildPaletteCommands(
  backendCmds: CommandInfo[],
  locale: string,
): PaletteCommand[] {
  const lang = locale.startsWith("fr") ? "fr" : "en";
  const mk = (
    canonical: string,
    args: PaletteArg[],
    readable?: { en: string; fr: string },
  ): PaletteCommand => ({
    canonical,
    label: commandLabel(canonical),
    names: commandTranslations(canonical),
    readable: readable?.[lang] || canonical,
    args,
  });
  const backend = backendCmds.map((c) => mk(c.command, c.args, c.readable));
  const locals = LOCAL_COMMANDS.filter(
    (c) => !backendCmds.some((b) => b.command === c),
  ).map((c) => mk(c, LOCAL_ARGS[c] ?? [], LOCAL_READABLE[c]));
  return [...backend, ...locals];
}

/**
 * The catalogue, ranked against what has been typed. THE list the bar draws.
 *
 * Matched on the SENTENCE and on the command's name, best of the two: a person who knows the
 * verb types the verb, and a person who knows what they want types what they want. Both roads
 * lead to the same row, which is the whole reason the descriptions exist.
 *
 * `fuzzyScore` is the shell's one matcher (fuzzy.ts) — the same subsequence rule the file
 * picker and the module search use, so "type a few letters" behaves the same everywhere.
 *
 * An empty query keeps the catalogue's own order: it groups by area (tracks, then modules, then
 * transport), which is more useful to scan than an alphabet.
 */
export function rankCommands(
  commands: readonly PaletteCommand[],
  query: string,
  recent: readonly string[] = [],
  limit = 30,
): PaletteCommand[] {
  const q = query.trim();
  if (!q) return commands.slice(0, limit);
  return (
    commands
      .map((c) => ({
        c,
        // The name scores slightly higher on a tie: someone typing "mute" means the command.
        score: Math.max(
          fuzzyScore(q, c.readable),
          fuzzyScore(q, c.canonical) + 0.5,
        ),
      }))
      // Filtered BEFORE the bonus, and that order is the whole safety of it: `fuzzyScore` says
      // "no match" with -1, and a recent command given four points for nothing would surface on a
      // query it does not match at all. History reorders what matched; it never invents a match.
      .filter((x) => x.score >= 0)
      .map((x) => ({
        ...x,
        score: x.score + recencyBonus(x.c.canonical, recent),
      }))
      .sort(
        (a, b) =>
          b.score - a.score || a.c.canonical.localeCompare(b.c.canonical),
      )
      .slice(0, limit)
      .map((x) => x.c)
  );
}

/**
 * What having used a command lately is worth, added to its match score.
 *
 * A NUDGE and not an override, which is the whole design of it. `fuzzyScore` gives roughly four
 * points per matched character, so four points is about one letter's worth: enough to lift a
 * command you use daily above an equally good match you have never run, and not nearly enough
 * to put a poor match above a good one. A palette that answered with your history instead of
 * with your query would be worse than one with no history at all.
 *
 * It decays down the list, so the thing you just did outranks the thing you did ten commands
 * ago, and the twelfth is worth almost nothing — which is how it forgets without a clock.
 */
function recencyBonus(canonical: string, recent: readonly string[]): number {
  const i = recent.indexOf(canonical);
  return i < 0 ? 0 : RECENT_BONUS * (1 - i / MAX_RECENT);
}

const RECENT_BONUS = 4;

/**
 * Which command a canonical LINE runs — the longest name that prefixes it, or null.
 *
 * Longest, exactly as the dispatcher picks it (`runCommand` in commandSpec.ts), or `module list`
 * would claim a line that `module list plugins` is going to run and the history would remember
 * the wrong one.
 */
export function commandNameOf(
  line: string,
  commands: readonly PaletteCommand[],
): string | null {
  const s = line.trim();
  let best: string | null = null;
  for (const c of commands)
    if (
      (s === c.canonical || s.startsWith(`${c.canonical} `)) &&
      (!best || c.canonical.length > best.length)
    )
      best = c.canonical;
  return best;
}

/** A param's candidate values, ranked the same way. Empty query keeps the provider's order. */
export function rankValues(
  values: readonly string[],
  query: string,
  limit = 30,
): string[] {
  const q = query.trim();
  if (!q) return values.slice(0, limit);
  return values
    .map((v) => ({ v, score: fuzzyScore(q, v) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.v.localeCompare(b.v))
    .slice(0, limit)
    .map((x) => x.v);
}

/**
 * One param's WHOLE vocabulary, given the params before it. `file`'s paths come from the open
 * project (the `files` getter); everything else asks the backend for the assembled line and
 * lifts out the token at this position.
 *
 * The list is fetched whole and ranked in the browser (`rankValues`), rather than asking the
 * backend to narrow it on every keystroke. Two things come of that. The match is FUZZY, like
 * everywhere else the shell searches — the backend's `completions` narrows by prefix, which
 * cannot find `ge.rythm` from "rythm". And a field costs one round trip instead of one per
 * letter, on a service that is a single Node process and queues what it is asked.
 */
export function makeListArg(files: () => string[]) {
  return async (command: string, priorArgs: string[]): Promise<string[]> => {
    const canonical = canonicalizeCommand(command);
    const partial = ""; // the whole vocabulary; the ranking is the browser's
    // `new project`'s first arg is a fixed choice the backend knows nothing about, so offer it
    // here. `m9` is a SET — two decks and a crossfade — and `v1` a CUT — a viewport and its
    // lanes; both land as folders this app cannot open. They are offered anyway because the
    // workspace is one clone and l8 is where the command bar is.
    if (canonical === "new project" && priorArgs.length === 0)
      return ["audio", "m9", "v1"];
    if (canonical === "file" && priorArgs.length === 0) return files();
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
