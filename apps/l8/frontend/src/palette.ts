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

// Everything whose ONLY effect is on the shell lives under `ui` — the namespace promises it touches nothing of
// the PROJECT and never moves the transport. Not "writes no file": a pin, a language and the vim flag are
// remembered (localStorage, the account's preferences), and remembering how you like to work is not editing a
// song. `locate`, `loop`, `record`, `new/delete project`, `event move` and the file-tree verbs keep bare names.
export const LOCAL_COMMANDS = [
  "ui file", // open a file in the editor by fuzzy name (completes against the project)
  "ui global", // the layout view — the default, and the only one a project does not derive
  ...PANES.map((p) => `ui ${p}`), // fullscreen one pane
  "ui focus next", // move the keys to the next pane (tab)
  "ui close", // close the bottom panel
  "ui popin close", // close the topmost overlay (what Esc reaches for first)
  "ui slot close", // put the graph back where a grid, a clip or a take had taken its place
  "ui edit sequence", // open a MIDI sequence's file in the editor
  "ui edit clip", // open an audio clip's file in the editor
  // A sequence's notes where the graph is, until the × puts the graph back. Bare-named: they
  // name a sequence and open an editor that WRITES to it, which is the line `ui` draws.
  "sequence edit roll",
  "sequence edit tracker",
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
  "transport replay", // back to where playback last started, and roll again (shift+space)
  "event move", // pick up the clip under the caret and nudge it; commits to disk
  "ui help", // the `?` overlay: commands, keys, and the song-file syntax reference
  // The footer's own buttons, beside the panel row, and the two toggles in the timeline's header.
  "ui mixer", // line the mixer strips up in the graph's pane
  "ui notes", // draw the project's doc modules on the graph
  "ui panel", // open one of the bottom panels (graph | logs)
  "ui surface", // a screen this PROJECT declares — surfaces/, layout: view
  "ui builder", // the shared module builder, over the shell
  "ui review", // reopen the take review on a clip — waveform, onsets, level
  "ui ruler", // the timeline's ruler: bars or seconds
  "ui lanes", // tall lanes, showing each clip's waveform or notes
  "ui logs clear",
  // The cog menu. All five leave the project alone, which is why they are `ui`.
  "ui settings editor",
  "ui settings io",
  "ui vim", // the editor's modality — the toggle on the settings screen
  "ui engine", // back to the engine picker
  "ui workspace quit",
  "ui logout",
  "ui language",
  "ui pin", // a file to the top of the tree, or off it
  "ui copy path", // the tree's other entry — the path onto the clipboard
  // Bare-named, because they WRITE — the line `ui` draws (see the head of this list). The undo
  // journal, the mixdown, the k7 publish, and the file tree's own right-click verbs.
  "project undo",
  "project redo",
  "project export",
  "project share k7",
  "project import",
  "fs file new",
  "fs folder new",
  "fs file rename",
  "fs file move",
  "fs file delete",
  "fs file upload",
  // The rack builder popin: a 4×4 pad grid that ends in a `modules/instruments/<name>` on
  // disk. Web-local because the building is the browser's (drops, audition); the create
  // writes through the file routes like the tree's own verbs.
  "module create rack",
];

/**
 * What the shell's OWN commands do, as a sentence, in each language.
 *
 * The backend's carry theirs in `commands.yaml`; these exist only in this app, so this is their
 * catalogue entry. Same rules: imperative, no example, no full stop, and **60 characters at
 * most** in each language — the palette lists them side by side and a reader cannot tell which
 * half a row came from, nor should they. `palette.test.ts` holds this half to all of it.
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
  "ui viewport": {
    en: "Fullscreen the picture",
    fr: "Passer l'image en plein écran",
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
  "ui popin close": {
    en: "Close the overlay in front",
    fr: "Fermer la fenêtre au premier plan",
  },
  "ui slot close": {
    en: "Show the chains graph again",
    fr: "Réafficher le graphe des chaînes",
  },
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
  "transport replay": {
    en: "Play again from where playback last started",
    fr: "Rejouer depuis le dernier départ de lecture",
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
  "sequence edit roll": {
    en: "Show a sequence's notes as a piano roll",
    fr: "Afficher les notes d'une séquence en piano roll",
  },
  "sequence edit tracker": {
    en: "Show a sequence's notes as a tracker",
    fr: "Afficher les notes d'une séquence en tracker",
  },
  "ui mixer": {
    en: "Line up the mixer strips",
    fr: "Aligner les tranches de la console",
  },
  "ui notes": {
    en: "Show or hide the notes on the graph",
    fr: "Afficher ou masquer les notes du graphe",
  },
  "ui panel": {
    en: "Open a panel at the bottom",
    fr: "Ouvrir un panneau en bas",
  },
  "ui surface": {
    en: "Open a surface this project declares",
    fr: "Ouvrir une surface déclarée par le projet",
  },
  "ui builder": {
    en: "Edit a module in the builder",
    fr: "Modifier un module dans le constructeur",
  },
  "ui review": {
    en: "Reopen the take review on a clip",
    fr: "Rouvrir la relecture d'une prise",
  },
  "ui ruler": {
    en: "Read the ruler in bars or in seconds",
    fr: "Lire la règle en mesures ou en secondes",
  },
  "ui lanes": {
    en: "Show what the clips hold, in the lanes",
    fr: "Afficher le contenu des clips dans les pistes",
  },
  "ui logs clear": {
    en: "Empty the log panel",
    fr: "Vider le journal",
  },
  "ui settings editor": {
    en: "Open the editor's settings",
    fr: "Ouvrir les réglages de l'éditeur",
  },
  "ui settings io": {
    en: "Open the audio inputs and outputs",
    fr: "Ouvrir les entrées et sorties audio",
  },
  "ui vim": {
    en: "Turn the editor's vim mode on or off",
    fr: "Activer ou désactiver le mode vim de l'éditeur",
  },
  "ui engine": {
    en: "Choose another engine",
    fr: "Choisir un autre moteur",
  },
  "ui workspace quit": {
    en: "Leave this workspace",
    fr: "Quitter cet espace de travail",
  },
  "ui logout": { en: "Sign out", fr: "Se déconnecter" },
  "ui language": {
    en: "Change the interface language",
    fr: "Changer la langue de l'interface",
  },
  "ui pin": {
    en: "Pin a file to the top of the tree",
    fr: "Épingler un fichier en haut de l'arbre",
  },
  "ui copy path": {
    en: "Copy a file's path to the clipboard",
    fr: "Copier le chemin d'un fichier dans le presse-papiers",
  },
  "project undo": {
    en: "Undo the last change",
    fr: "Annuler la dernière modification",
  },
  "project redo": {
    en: "Redo the change you took back",
    fr: "Rétablir la modification annulée",
  },
  "project export": {
    en: "Render the mixdown and download it",
    fr: "Rendre le mixage et le télécharger",
  },
  "project share k7": {
    en: "Publish this song to k7",
    fr: "Publier ce morceau sur k7",
  },
  "project import": {
    en: "Import a .dawproject or an .als",
    fr: "Importer un .dawproject ou un .als",
  },
  "fs file new": { en: "Create an empty file", fr: "Créer un fichier vide" },
  "fs folder new": { en: "Create a folder", fr: "Créer un dossier" },
  "fs file rename": {
    en: "Rename a file or a folder",
    fr: "Renommer un fichier ou un dossier",
  },
  "fs file move": {
    en: "Move a file into another folder",
    fr: "Déplacer un fichier dans un autre dossier",
  },
  "fs file delete": {
    en: "Send a file to the recycle bin",
    fr: "Envoyer un fichier à la corbeille",
  },
  "fs file upload": {
    en: "Upload files into a folder",
    fr: "Envoyer des fichiers dans un dossier",
  },
  "module create rack": {
    en: "Build a samples rack on a pad grid",
    fr: "Construire un rack de samples sur une grille",
  },
};

// The trailing params for the shell's own commands; `kind` is what the param NAMES, and colours the field
export const LOCAL_ARGS: Record<string, PaletteArg[]> = {
  "ui file": [{ name: "path", kind: "file", hint: "a file of this project" }],
  // `shape` is the fixed audio|live|set choice completed below in makeCompleteArg.
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
  "sequence edit roll": [
    { name: "sequence", kind: "file", hint: "a sequence of this project" },
  ],
  "sequence edit tracker": [
    { name: "sequence", kind: "file", hint: "a sequence of this project" },
  ],
  // The four fixed sets below are completed in makeCompleteArg: none of them is a project's,
  // so there is nothing for the backend to answer and no round trip to spend asking.
  "ui panel": [{ name: "panel", kind: "choice", hint: "graph · logs" }],
  "ui surface": [
    { name: "surface", kind: "choice", hint: "a surface of this project" },
  ],
  "ui language": [{ name: "language", kind: "choice", hint: "en · fr" }],
  "project export": [{ name: "format", kind: "choice", hint: "wav · mp3" }],
  "ui builder": [
    { name: "module", kind: "module", hint: "a module of this project" },
  ],
  // `file` is the class a clip is drawn in — see ArgClass, where a clip, a sequence and an asset
  // are all files. The completion below narrows it to clips/ and hands back the ID, not the path.
  "ui review": [
    { name: "clip", kind: "file", hint: "a clip of this project — a take" },
  ],
  "ui pin": [{ name: "path", kind: "file", hint: "a file of this project" }],
  "ui copy path": [
    { name: "path", kind: "file", hint: "a file or folder of this workspace" },
  ],
  "project import": [
    {
      name: "path",
      kind: "file",
      hint: "a .dawproject or .als of this workspace",
    },
  ],
  // The file verbs take TREE ENTRIES — folders included, and binaries kept. `ui file`'s `path`
  // above is the narrower list of what the editor can open: renaming a .wav is not opening it.
  "fs file new": [
    { name: "folder", kind: "file", hint: "the folder it goes in" },
    { name: "name", kind: "text", hint: "the new file's name" },
  ],
  "fs folder new": [
    { name: "folder", kind: "file", hint: "the folder it goes in" },
    { name: "name", kind: "text", hint: "the new folder's name" },
  ],
  "fs file rename": [
    { name: "path", kind: "file", hint: "a file or folder of this workspace" },
    { name: "name", kind: "text", hint: "its new name — it does not move" },
  ],
  "fs file move": [
    { name: "path", kind: "file", hint: "a file or folder of this workspace" },
    { name: "folder", kind: "file", hint: "where it goes" },
  ],
  "fs file delete": [
    { name: "path", kind: "file", hint: "a file or folder of this workspace" },
  ],
  "fs file upload": [
    { name: "folder", kind: "file", hint: "where the files land" },
    { name: "what", kind: "choice", hint: "files · folder" },
  ],
};

// The commands whose `path`/`folder` argument names any TREE ENTRY rather than an openable file.
const ENTRY_COMMANDS = new Set([
  "fs file new",
  "fs folder new",
  "fs file rename",
  "fs file move",
  "fs file delete",
  "fs file upload",
  "ui pin",
  "ui copy path",
  "project import",
]);

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
 * Longest, exactly as the dispatcher picks it (`runCommand` in commandSpec.ts), or a `system
 * plugins` would claim a line that `system plugins list` is going to run and the history would
 * remember the wrong one.
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
export function makeListArg(shell: {
  /** What the editor can OPEN — `ui file`'s vocabulary. */
  files: () => string[];
  /** Every path the tree draws, folders included — what a `file …` verb may name. */
  entries: () => string[];
  /** The screens this project declares (`surfaces/`, `layout: view`). */
  surfaces: () => string[];
  /** The languages the shell is compiled for. */
  locales: () => string[];
}) {
  return async (command: string, priorArgs: string[]): Promise<string[]> => {
    const canonical = canonicalizeCommand(command);
    const partial = ""; // the whole vocabulary; the ranking is the browser's
    const first = priorArgs.length === 0;
    // The shell's other fixed sets. Each is the shell's OWN vocabulary — a panel, a language,
    // an output format — so asking the backend for it would be a round trip for a literal.
    if (canonical === "ui panel" && first) return ["graph", "logs"];
    if (canonical === "ui language" && first) return shell.locales();
    if (canonical === "project export" && first) return ["wav", "mp3"];
    if (canonical === "fs file upload" && !first) return ["files", "folder"];
    // …and the ones that are the project's, but that only this app can answer.
    if (canonical === "ui surface" && first) return shell.surfaces();
    if (canonical === "ui file" && first) return shell.files();
    if (canonical === "ui builder" && first)
      return shell.files().filter((f) => /(^|\/)module\.ya?ml$/i.test(f));
    // The review takes a clip ID, not a path — `clip normalize` and `clip onset` name it that way
    // too, and the panel passes it straight to them. So the tree is filtered to clips/ and the
    // basename handed back, which is what the id IS (see recordTake: the filename is the id).
    if (canonical === "ui review" && first)
      return shell
        .files()
        .filter((f) => /(^|\/)clips\/[^/]+\.ya?ml$/i.test(f))
        .map((f) => (f.split("/").pop() ?? f).replace(/\.ya?ml$/i, ""));
    if (ENTRY_COMMANDS.has(canonical)) {
      // WHICH of this command's arguments names a path is declared in LOCAL_ARGS, right above.
      // Reading it here is what stops a NAME field — `fs file rename`'s second — being answered
      // with the whole tree.
      const arg = LOCAL_ARGS[canonical]?.[priorArgs.length];
      return arg?.kind === "file" ? shell.entries() : [];
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
