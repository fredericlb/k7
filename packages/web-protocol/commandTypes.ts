// commandTypes.ts — the palette's catalogue as GET /commands serves it, mirroring
// packages/commands/src/commandSpec.ts. Re-exported by types.ts.

// GET /commands — the palette's catalogue; mirrors ARG_CLASSES in packages/commands/src/commandSpec.ts.
export type ArgClass =
  | "track"
  | "module"
  | "file"
  | "marker"
  | "choice"
  | "timecode"
  | "number"
  | "note"
  | "text";
// The PRECISE type of thing an argument names, where `kind` is only its colour — see docs/document.md.
export type ArgProvider =
  // A BOX this project declares — `assemblies/<name>.k7x`, see packages/song/docs/assemblies.md.
  | "assemblies"
  // …and a TEMPLATE the library holds, which is what a new one is made from.
  | "assemblyTemplates"
  | "audioFiles"
  | "baseModules"
  | "engineModules"
  | "categories"
  | "chains"
  | "clipTargets"
  // One of the origin's libraries, by name — what `library upgrade` moves the pin of.
  | "libraries"
  // An automation CURVE of this project, by id — what `node automate` points a param at.
  | "curves"
  | "markerNames"
  | "modules"
  | "moduleAlternatives"
  | "moduleEngines"
  // One of this project's USES of a module, which is what the `node …` verbs address — packages/song/docs/nodes.md.
  | "nodes"
  // A PICTURE lane of this song — video_tracks/<id>.k7x, read off the folder rather than the compile.
  | "pictureLanes"
  // A set list of the REPOSITORY — with `libraries`, a provider that reads nothing of the open project.
  | "playlists"
  // A sample a rack tap may play — a library's or this project's `samples/`, packages/song/docs/libraryFiles.md.
  | "samples"
  | "sequenceFiles"
  // The kinds of SURFACE the editor can draw — a closed set of words, since the file is about to be created.
  | "surfaceTypes"
  | "tracks";
export interface CommandArg {
  name: string;
  kind: ArgClass;
  // What this argument NAMES off the project — what k7's contextMenu.ts matches a right-click on.
  provider?: ArgProvider;
  // One line on what this argument accepts; empty when there is nothing to promise, and the palette shows no clue.
  hint: string;
  // TRAILING args only: the line runs without it, so a form knows when it has collected enough.
  optional?: boolean;
}
// What a right-click can be ON, as commands.yaml `menu:` names it — mirrors MENU_ENTITIES in packages/commands/src/commandSpec.ts.
export const MENU_ENTITIES = [
  "track",
  "group",
  // A block in the graph or on a lane's strip: the USE of a module, which is what the `node …` verbs address.
  "node",
  // A PLACEMENT on a lane, plus the rectangle a drag left around it.
  "event",
  "param",
  "curve",
  // The timeline RULER, where nothing is yet — what a click there could put one.
  "ruler",
  "marker",
  "assembly",
  // A stretch point in a clip's warp view.
  "warp",
  // A shot on a picture lane.
  "shot",
  "pad",
  "note",
  // A rack's PAD on a node's card: one sound of the kit.
  "tap",
] as const;
export type MenuEntity = (typeof MENU_ENTITIES)[number];
export interface CommandInfo {
  command: string;
  help?: string;
  // One sentence per language on what the command DOES; the NAME is never translated — see docs/document.md.
  readable?: { en: string; fr: string };
  args: CommandArg[];
  // Where a right-click may offer it. Absent ⇒ wherever its leading arguments fit — k7's frontend/docs/contextMenu.md.
  menu?: MenuEntity[];
  // The menu asks before running it — the one exception to "nothing here asks twice", same page.
  confirm?: boolean;
}
