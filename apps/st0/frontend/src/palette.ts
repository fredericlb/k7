// palette.ts — the shell's own command catalogue for the palette, its readable
// descriptions, the fuzzy ranking the bar lists by, and each argument's vocabulary.
// Apart from the shell because everything here is a pure function of the backend's catalogue
// plus a `files()` getter, with no shell state. See docs/commandBar.md.

import type { Completion } from "@studio/project-shell/project";
import { api } from "./api";
import { type ArgOption, optionsFromCompletions } from "./argOptions";
import {
  canonicalizeCommand,
  commandLabel,
  commandTranslations,
} from "./commandI18n";
import type { PaletteArg, PaletteCommand } from "./components/CommandBar";
// Everything whose ONLY effect is on the shell lives under `ui` — not 'writes no file': a pin and a language are remembered, which is not editing a song.
import { MIX_FORMATS, VIDEO_FORMATS } from "./exportArgs";
import { fuzzyScore } from "./fuzzy";
import { MAX_RECENT } from "./recentCommands";
import { ROLL_MODES } from "./rollMode";
import { PANES } from "./shellMeta";
import { TOOLS } from "./timelineTools";
import type { CommandInfo, MenuEntity } from "./types";
import { WAVE_MODES } from "./waveMode";

export {
  type ArgOption,
  optionsFromCompletions,
  rankOptions,
  rankValues,
  toOptions,
} from "./argOptions";

export const LOCAL_COMMANDS = [
  "ui file", // open a file in the editor by fuzzy name (completes against the project)
  "ui assembly", // open an assembly TEMPLATE in the builder, by the ref a box names
  "ui global", // the home page — the timeline, or the first pane a project without one declares
  ...PANES.map((p) => `ui ${p}`), // fullscreen one pane
  "ui focus next", // move the keys to the next pane (tab)
  "ui close", // close the bottom panel
  "ui popin close", // close the topmost overlay (what Esc reaches for first)
  "ui slot close", // put the graph back where a grid, a clip or a take had taken its place
  "ui edit sequence", // open a MIDI sequence's file in the editor
  "ui edit clip", // open an audio clip's file in the editor
  // A sequence's notes where the graph is. Bare-named: they open an editor that WRITES to the sequence they name.
  "sequence edit roll",
  "sequence edit tracker",
  // Arm MIDI learn on a module's param — a UI command because the LISTENING is the browser's; `module cc` writes the map.
  "ui midi learn",
  // …and arm a PICTURE lane, for the same reason: the camera is the browser's and the engine never hears about it.
  "ui picture arm",
  // The timeline's selection, zoom, loop and move: the state lives in TimelineTab and these reach it via its handle.
  "ui tool", // what a PRESS means on the active surface — pointer · cut · erase · mute · crossfade
  "ui wave", // …and on an audio clip's waveform, where the view IS the gesture — standard · onsets · warp
  "ui roll", // …and on the piano roll — select · create · remove
  "ui select", // caret <-> selection rectangle
  "ui zoom", // frame the selection
  "ui zoom out", // back to the enclosing view
  "ui zoom reset", // back to the whole song
  "transport locate", // move the playhead to the caret
  "transport loop", // set/clear the transport loop from the selection
  "transport record", // the global record enable (engine session state, over the wire)
  "transport replay", // back to where playback last started, and roll again (shift+space)
  /** The RECTANGLE's own two, beside the catalogue's `selection consolidate` — one head for the three verbs that take a region. */
  "selection copy", // the selected rectangle onto the shell's clipboard (events or notes)
  "selection paste", // put it down at the caret — on the timeline, or in the open grid
  "selection delete", // remove what the rectangle holds, in ONE command line so it is one undo
  "event move", // pick up the clip under the caret and nudge it; commits to disk
  "ui help", // the `?` overlay: commands, keys, and the song-file syntax reference
  // The footer's own buttons, beside the panel row, and the two toggles in the timeline's header.
  "ui mixer", // the mix panel: the mixer strips lined up under the page
  "ui stack", // the graph as one column per track, the mix last
  "ui notes", // draw the project's doc modules on the graph
  "ui panel", // open one of the bottom panels (event | graph | logs)
  "ui surface", // a screen this PROJECT declares — surfaces/, layout: view
  "ui builder", // the shared module builder, over the shell
  "ui curve", // the curve editor: a new curve, or the one named
  "ui automate", // the curve editor on a control: the curve it follows, or a new one bound to it
  "ui review", // reopen the take review on a clip — waveform, onsets, level
  "ui ruler", // the timeline's ruler: bars or seconds
  "ui lanes", // tall lanes, showing each clip's waveform or notes
  "ui automation", // show or hide each lane's automation rows
  "ui curves", // show or hide the curve cards in the per-track graph view
  "ui logs clear",
  // The RIGHT-HAND panels and the settings tabs: all leave the project alone, and the bare lines toggle.
  "ui settings",
  "ui settings editor",
  "ui settings io",
  "ui settings project", // the open song's whole-mix settings — its console
  "ui settings account", // who you are, the engine, the workspace, the language
  "ui settings commands", // the one that is still a PAGE — see components/SettingsPanel.tsx
  "ui playlists", // the workspace's set lists — docs/playlists.md
  "ui references", // the workspace's reference tracks — docs/references.md
  "ui share", // commit, pull, export, publish — docs/shell.md
  // The LINK to a surface, for another device to open it on (docs/external.md) — `ui`, since it copies an address and changes nothing.
  "ui external",
  "ui vim", // the editor's modality — the toggle on the settings screen
  "ui engine", // back to the engine picker
  "ui workspace quit",
  "ui logout",
  "ui language",
  "ui pin", // a file to the top of the tree, or off it
  "ui copy path", // the tree's other entry — the path onto the clipboard
  // Bare-named, because they WRITE: the undo journal, the mixdown, the k7 publish, and the file tree's own right-click verbs.
  "project undo",
  "project redo",
  /** The header meter's Fix button as a verb — WEB-LOCAL because the pass's peak exists nowhere but in the browser that watched it. */
  "project master fix",
  "project export",
  "project share k7",
  "project share link",
  "project import",
  "fs file new",
  "fs folder new",
  "fs file rename",
  "fs file move",
  "fs file delete",
  "fs file upload",
  // The rack builder popin — web-local because the building is the browser's; the create writes through the file routes.
  "module create rack",
];

/** What the shell's OWN commands do, as a sentence, in each language — imperative, no example, no full stop, 60 characters at most. */
export const LOCAL_READABLE: Record<string, { en: string; fr: string }> = {
  "ui file": {
    en: "Open a file of this project in the editor",
    fr: "Ouvrir un fichier de ce projet dans l'éditeur",
  },
  "ui assembly": {
    en: "Open an assembly template in the builder",
    fr: "Ouvrir un modèle d'assemblage dans le constructeur",
  },
  "ui global": {
    en: "Back to the project's home page",
    fr: "Revenir à la page d'accueil du projet",
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
  "ui turntables": {
    en: "Fullscreen the DJ desk",
    fr: "Passer le pupitre DJ en plein écran",
  },
  "ui mastering": {
    en: "Fullscreen the master strip",
    fr: "Passer le pupitre de mastering en plein écran",
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
  "ui picture arm": {
    en: "Arm a picture lane to record its camera",
    fr: "Armer une piste vidéo pour enregistrer sa caméra",
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
  "selection copy": {
    en: "Copy the selected events or notes",
    fr: "Copier les événements ou notes sélectionnés",
  },
  "selection paste": {
    en: "Paste what was copied at the caret",
    fr: "Coller ce qui a été copié au curseur",
  },
  "selection delete": {
    en: "Delete the selected notes or events",
    fr: "Supprimer les notes ou événements sélectionnés",
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
  // Also in the backend's catalogue and filtered out when it is reachable — kept so the row is still described when it is not.
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
    en: "Show the mix panel",
    fr: "Afficher le panneau de mixage",
  },
  "ui stack": {
    en: "Stack the graph, one column per track",
    fr: "Empiler le graphe, une colonne par piste",
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
  "ui curve": {
    en: "Create or edit an automation curve",
    fr: "Créer ou modifier une courbe d'automation",
  },
  "ui automate": {
    en: "Automate a parameter with a curve",
    fr: "Automatiser un paramètre avec une courbe",
  },
  "ui review": {
    en: "Reopen the take review on a clip",
    fr: "Rouvrir la relecture d'une prise",
  },
  "ui tool": {
    en: "Choose what a press does on this surface",
    fr: "Choisir ce que fait un clic sur cette surface",
  },
  "ui wave": {
    en: "Choose what the waveform is for",
    fr: "Choisir à quoi sert la forme d'onde",
  },
  "ui roll": {
    en: "Choose what a press does on the piano roll",
    fr: "Choisir ce que fait un clic sur le piano roll",
  },
  "ui ruler": {
    en: "Read the ruler in bars or in seconds",
    fr: "Lire la règle en mesures ou en secondes",
  },
  "ui lanes": {
    en: "Show what the clips hold, in the lanes",
    fr: "Afficher le contenu des clips dans les pistes",
  },
  "ui automation": {
    en: "Show or hide the automation lanes",
    fr: "Afficher ou masquer les pistes d'automation",
  },
  "ui curves": {
    en: "Show or hide the curve cards in the per-track graph view",
    fr: "Afficher ou masquer les courbes dans la vue graphe par piste",
  },
  "ui logs clear": {
    en: "Empty the log panel",
    fr: "Vider le journal",
  },
  "ui settings": {
    en: "Open or close the settings panel",
    fr: "Ouvrir ou fermer le panneau de réglages",
  },
  "ui settings editor": {
    en: "Open the editor's settings",
    fr: "Ouvrir les réglages de l'éditeur",
  },
  "ui settings account": {
    en: "Open the account, engine and language settings",
    fr: "Ouvrir le compte, le moteur et la langue",
  },
  "ui settings commands": {
    en: "Rename, reorder and rebind the commands",
    fr: "Renommer, réordonner et relier les commandes",
  },
  "ui settings io": {
    en: "Open the audio inputs and outputs",
    fr: "Ouvrir les entrées et sorties audio",
  },
  "ui settings project": {
    en: "Open the project's settings — its mix console",
    fr: "Ouvrir les réglages du projet — sa console de mix",
  },
  "ui playlists": {
    en: "Open or close this repository's playlists",
    fr: "Ouvrir ou fermer les playlists de ce dépôt",
  },
  "ui references": {
    en: "Open or close this repository's reference tracks",
    fr: "Ouvrir ou fermer les morceaux de référence de ce dépôt",
  },
  "ui share": {
    en: "Open or close the share and export panel",
    fr: "Ouvrir ou fermer le panneau de partage",
  },
  "ui external": {
    en: "Copy a surface's link, to drive it from another device",
    fr: "Copier le lien d'une surface, pour un autre appareil",
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
  "project master fix": {
    en: "Lower every strip until the last pass fits",
    fr: "Baisser les tranches pour rentrer le dernier passage",
  },
  "project export": {
    en: "Render the mixdown or the picture, and download it",
    fr: "Rendre le mixage ou l'image, et le télécharger",
  },
  "project share k7": {
    en: "Publish this song to k7",
    fr: "Publier ce morceau sur k7",
  },
  "project share link": {
    en: "Share a frozen copy by link",
    fr: "Partager une copie gelée par lien",
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
  "ui assembly": [
    {
      name: "ref",
      kind: "module",
      hint: "an assembly template the library holds (@st0/<path>)",
    },
  ],
  "ui external": [
    { name: "surface", kind: "text", hint: "a surface this project declares" },
  ],
  // `shape` is the fixed audio|live|set choice completed below in makeCompleteArg.
  "ui edit sequence": [
    { name: "name", kind: "file", hint: "a sequence of this project" },
  ],
  "ui midi learn": [
    { name: "module", kind: "module", hint: "a module of this project" },
    { name: "param", kind: "text", hint: "the name its widget binds" },
  ],
  "ui automate": [
    { name: "node", kind: "module", hint: "a node of this project" },
    { name: "param", kind: "text", hint: "the name its widget binds" },
  ],
  "ui picture arm": [
    { name: "lane", kind: "text", hint: "a picture lane — bare, it disarms" },
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
  // The four fixed sets below are completed in makeCompleteArg: none is a project's, so there is no round trip to spend.
  "ui panel": [{ name: "panel", kind: "choice", hint: "event · graph · logs" }],
  "ui tool": [
    {
      name: "tool",
      kind: "choice",
      hint: "pointer · cut · erase · mute · crossfade",
    },
  ],
  "ui wave": [
    { name: "view", kind: "choice", hint: "standard · onsets · warp" },
  ],
  "ui roll": [
    { name: "mode", kind: "choice", hint: "select · create · remove" },
  ],
  "ui surface": [
    { name: "surface", kind: "choice", hint: "a surface of this project" },
  ],
  "ui language": [{ name: "language", kind: "choice", hint: "en · fr" }],
  // Which HALF leaves first, then its format — and for a video, the sound married into it.
  "project export": [
    { name: "what", kind: "choice", hint: "audio · video" },
    { name: "format", kind: "choice", hint: "wav · mp3 · webm · mp4" },
    {
      name: "sound",
      kind: "choice",
      hint: "the video's audio — wav · mp3 · none",
    },
  ],
  // Optional, and the blank is the ordinary answer: a number is for the case the meter cannot serve — another tab, a CLI.
  "project master fix": [
    {
      name: "peak",
      kind: "number",
      optional: true,
      hint: "the pass's peak in dB — the header meter's own when left blank",
    },
  ],
  "ui builder": [
    { name: "module", kind: "module", hint: "a module of this project" },
  ],
  "ui curve": [
    {
      name: "curve",
      kind: "file",
      optional: true,
      hint: "a curve of this project — none for a new one",
    },
  ],
  // `file` is the class a clip is drawn in (see ArgClass); the completion below narrows it to clips/ and hands back the ID.
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
  // The file verbs take TREE ENTRIES, folders included and binaries kept — `ui file`'s `path` above is the narrower list.
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

/** The palette's full catalogue: the backend's commands plus the shell's own, each description resolved ONCE by `locale`. */
export function buildPaletteCommands(
  backendCmds: CommandInfo[],
  locale: string,
): PaletteCommand[] {
  const lang = locale.startsWith("fr") ? "fr" : "en";
  const mk = (
    canonical: string,
    args: PaletteArg[],
    readable?: { en: string; fr: string },
    menu?: MenuEntity[],
  ): PaletteCommand => ({
    canonical,
    label: commandLabel(canonical),
    names: commandTranslations(canonical),
    readable: readable?.[lang] || canonical,
    // The whole table too, for the one screen that offers a field per language; everything else reads `readable` above.
    ...(readable ? { readableBy: { ...readable } } : {}),
    args,
    // Where the CATALOGUE offers it on a right-click; the shell's own commands say nothing, so every menu their arguments fit may.
    ...(menu ? { menu } : {}),
  });
  const backend = backendCmds.map((c) =>
    mk(c.command, c.args, c.readable, c.menu),
  );
  const locals = LOCAL_COMMANDS.filter(
    (c) => !backendCmds.some((b) => b.command === c),
  ).map((c) => mk(c, LOCAL_ARGS[c] ?? [], LOCAL_READABLE[c]));
  return [...backend, ...locals];
}

/** The catalogue, ranked against what has been typed — matched on the SENTENCE and on the name, best of the two (fuzzy.ts). */
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
      // Filtered BEFORE the bonus, and that order is the safety of it: history reorders what matched, and never invents a match.
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

/** What having used a command lately is worth — a NUDGE of about one letter's worth, decaying down the list, which is how it forgets. */
function recencyBonus(canonical: string, recent: readonly string[]): number {
  const i = recent.indexOf(canonical);
  return i < 0 ? 0 : RECENT_BONUS * (1 - i / MAX_RECENT);
}

const RECENT_BONUS = 4;

/** Which command a canonical LINE runs — the longest name that prefixes it, exactly as the dispatcher picks it. */
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

/** One param's WHOLE vocabulary, given the params before it — fetched whole and ranked in the browser, so the match is fuzzy and costs one round trip. */
export function makeListArg(shell: {
  /** What the editor can OPEN — `ui file`'s vocabulary. */
  files: () => string[];
  /** Every path the tree draws, folders included — what a `file …` verb may name. */
  entries: () => string[];
  /** The surfaces this project declares, by id — `ui external`'s vocabulary, and only this app can enumerate one project's. */
  surfaces: () => string[];
  /** The languages the shell is compiled for. */
  locales: () => string[];
}) {
  return async (
    command: string,
    priorArgs: string[],
  ): Promise<(string | ArgOption)[]> => {
    const canonical = canonicalizeCommand(command);
    const partial = ""; // the whole vocabulary; the ranking is the browser's
    const first = priorArgs.length === 0;
    // The shell's other fixed sets, each the shell's OWN vocabulary — asking the backend would be a round trip for a literal.
    if (canonical === "ui panel" && first)
      return ["event", "graph", "mix", "logs"];
    if (canonical === "ui tool" && first) return [...TOOLS];
    if (canonical === "ui wave" && first) return [...WAVE_MODES];
    if (canonical === "ui roll" && first) return [...ROLL_MODES];
    if (canonical === "ui language" && first) return shell.locales();
    if (canonical === "project export") {
      if (first) return ["audio", "video"];
      // The format offered depends on the half: only a video has a container, and only a video
      // takes a third word at all.
      if (priorArgs.length === 1)
        return priorArgs[0] === "video" ? [...VIDEO_FORMATS] : [...MIX_FORMATS];
      if (priorArgs.length === 2 && priorArgs[0] === "video")
        return [...MIX_FORMATS, "none"];
      return [];
    }
    if (canonical === "fs file upload" && !first) return ["files", "folder"];
    // …and the ones that are the project's, but that only this app can answer.
    if (canonical === "ui external" && first) return shell.surfaces();
    if (canonical === "ui file" && first) return shell.files();
    if (canonical === "ui builder" && first)
      return shell.files().filter((f) => /(^|\/)module\.ya?ml$/i.test(f));
    // A curve is named by its id, its file's basename, as a clip is below.
    if (canonical === "ui curve" && first)
      return shell
        .files()
        .filter((f) => /(^|\/)curves\/[^/]+\.ya?ml$/i.test(f))
        .map((f) => (f.split("/").pop() ?? f).replace(/\.ya?ml$/i, ""));
    // The review takes a clip ID, not a path, so the tree is filtered to clips/ and the basename handed back, which is what the id IS.
    if (canonical === "ui review" && first)
      return shell
        .files()
        .filter((f) => /(^|\/)clips\/[^/]+\.ya?ml$/i.test(f))
        .map((f) => (f.split("/").pop() ?? f).replace(/\.ya?ml$/i, ""));
    if (ENTRY_COMMANDS.has(canonical)) {
      // WHICH of this command's arguments names a path is declared in LOCAL_ARGS, which is what stops a NAME field being answered with the tree.
      const arg = LOCAL_ARGS[canonical]?.[priorArgs.length];
      return arg?.kind === "file" ? shell.entries() : [];
    }
    // The line MUST end with a space, even for an empty partial: that is how `completions` tells an argument from a command name.
    const line = [canonical, ...priorArgs, partial].join(" ");
    const full = await api.complete(line).catch(() => [] as Completion[]);
    // `completions` answers with whole LINES, so the prefix we sent is what is sliced back off.
    return optionsFromCompletions(
      full,
      `${[canonical, ...priorArgs].join(" ")} `,
    );
  };
}
