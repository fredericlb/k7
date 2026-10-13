// commandSpec.ts — the declarative half of the command layer: commands.yaml maps what you
// TYPE ("module new") to a feature SID, plus fixed args, an argument/completion spec, and
// the surfaces it appears on. Drives both completions() and runCommand(), shared by the
// web editor and the CLI; the behaviours themselves live in commands.ts.

import { type Dirent, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chainNames } from "@studio/audio-passes/processChain";
import { libraryAssemblies, projectAssemblies } from "@studio/song/assemblies";
import { loadCurves } from "@studio/song/curves";
import { nodeCaption, nodePlaces } from "@studio/song/graph";
import { libraryFiles } from "@studio/song/libraryFiles";
import { loadModuleRefs, loadModules, MODULE_TYPES } from "@studio/song/loader";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { alternativesOf } from "@studio/song-schema/alternatives";
import {
  completionOrder,
  isEngineRef,
  type ModuleStatus,
  moduleStatusOf,
} from "@studio/song-schema/moduleTypes";
import { PLAYLISTS_DIR } from "@studio/song-schema/playlist";
import { parsePosition } from "@studio/song-schema/timecode";
import { allSurfaceTypes } from "@studio/song-schema/yaml/surfaceRegistry";
import { parse as parseYaml } from "yaml";
import {
  type CommandHost,
  collectPluginModules,
  parseMidiNote,
  registerCommand,
  SID_HANDLERS,
  type SidHandler,
} from "./commands";

// One surface — the web backend dispatches under "cli" too — but it stays a type.
export type Surface = "cli";

// A scalar shape checked before the handler, for ONE-token arguments only — docs/completions.md.
export type ArgKind = "timecode" | "number" | "note";

export interface ArgSpec {
  name: string;
  // The value's shape. Absent = free text, validated (if at all) by the handler.
  type?: ArgKind;
  // A named provider, checked against PROVIDERS at load, so a typo is reported rather than completing nothing.
  complete?: ProviderName;
  // …or a literal set written in the yaml, so the palette does not ask for what it already knows.
  values?: string[];
  // A one-line clue about what this argument ACCEPTS — worth writing when the class's own clue doesn't say enough.
  hint?: string;
  // TRAILING args only: the line runs without it. See docs/optionalArgs.md.
  optional?: boolean;
}
/** What a command does, as a sentence, in each language a surface can be asked for. */
export interface ReadableDescription {
  en: string;
  fr: string;
}

export interface CommandSpec {
  command: string; // the typed prefix (may contain spaces/colons)
  sid: string;
  help?: string;
  // The palette's line, and what it fuzzy-matches on. See commands.yaml's header.
  readable?: ReadableDescription;
  surfaces: Surface[];
  /** Which right-click menus may offer it. Absent ⇒ every one whose click answers its leading args. */
  menu?: MenuEntity[];
  /** The menu asks before running it: what it destroys is more than one Ctrl+Z is trusted to bring back. */
  confirm?: boolean;
  // No fixed leading args: a verb that is one setting of another is the ARG's job — docs/completions.md.
  args?: ArgSpec[]; // trailing user args (for completion)
}

/** Each module's `status:`, off the ref map, for the providers that rank by it — docs/completions.md. */
function moduleStatuses(h: CommandHost): (name: string) => ModuleStatus {
  let refs: Record<string, unknown> = {};
  try {
    if (h.songPath) refs = loadModuleRefs(h.songPath);
  } catch {
    /* no ranking, still a complete list */
  }
  return (name) => moduleStatusOf(refs[name]);
}

// Named providers behind commands.yaml `complete:`; `satisfies` is load-bearing, docs/completions.md.
const PROVIDERS = {
  // `@engine` refs are for the libraries to extend, never a pick here — `engineModules` is the one verb's that wants them.
  baseModules: (h) => h.baseModules.filter((r) => !isEngineRef(r)),
  /** The scanned plugins alone — what `module own` gives a folder to. */
  engineModules: (h) => h.baseModules.filter(isEngineRef),
  /** The boxes this project declares — read off the folder, since a name is all a verb needs. */
  assemblies: (h) =>
    h.songPath ? projectAssemblies(h.songPath).assemblies.map((a) => a.id) : [],
  /** …and the templates the library holds, by ref — what `assembly new` makes one from. */
  assemblyTemplates: (h) =>
    h.songPath ? libraryAssemblies(h.songPath).map((a) => a.ref) : [],
  // The module category folders, each with a trailing "/" so completing leaves you at the name.
  categories: () => Object.keys(MODULE_TYPES).map((c) => `${c}/`),
  /** The project's blocks plus the INHERITED refs, minus `@engine` — see docs/completions.md. */
  modules: (h) =>
    completionOrder(
      [
        ...collectPluginModules(h.project()).map((b) => b.module),
        ...h.baseModules.filter((r) => r.startsWith("@") && !isEngineRef(r)),
      ],
      moduleStatuses(h),
    ),
  /** This project's NODES — its uses of modules, and no `@ref`. See docs/completions.md. */
  nodes: (h) => collectPluginModules(h.project()).map((b) => b.module),
  tracks: (h) => h.project().tracks.map((t) => t.id),
  /** Every alternative name in the project, deduped, off the module FILES — docs/completions.md. */
  moduleAlternatives: (h) => {
    if (!h.songPath) return [];
    try {
      return [
        ...new Set(
          Object.values(loadModules(h.songPath)).flatMap((m) =>
            alternativesOf(m)
              .slice(1)
              .map((a) => a.name),
          ),
        ),
      ];
    } catch {
      return []; // an unreadable module folder costs the completion, not the command
    }
  },
  /** Every engine name the project's modules offer, deduped — packages/song/docs/engines.md. */
  moduleEngines: (h) => {
    if (!h.songPath) return [];
    try {
      return [
        ...new Set(
          Object.values(loadModuleRefs(h.songPath)).flatMap((m) =>
            Object.keys(m.engineRefs ?? {}),
          ),
        ),
      ].sort();
    } catch {
      return []; // an unreadable module folder costs the completion, not the command
    }
  },
  // Marker names for `project marker delete`. A multi-word name doesn't complete cleanly, but single-word ones do.
  markerNames: (h) => h.project().markers.map((m) => m.name),
  /** The workspace's set lists, off `repoDir` and never `songPath` — see docs/completions.md. */
  playlists: (h) => {
    const root = h.repoDir;
    if (!root) return [];
    const out: string[] = [];
    const walk = (at: string, under: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(at, { withFileTypes: true });
      } catch {
        return; // no folder yet: an account with no set list has none, which is not an error
      }
      for (const e of entries) {
        const name = under ? `${under}/${e.name}` : e.name;
        if (e.isDirectory()) walk(join(at, e.name), name);
        else if (e.isFile() && /\.(ya?ml|k7x)$/i.test(e.name))
          out.push(name.replace(/\.(ya?ml|k7x)$/i, ""));
      }
    };
    walk(join(root, PLAYLISTS_DIR), "");
    return out.sort();
  },
  /** This song's picture LANES, off the folder — a lane the compiler refuses still has a file to name. */
  pictureLanes: (h) => {
    if (!h.songPath) return [];
    try {
      return readdirSync(join(h.songPath, "video_tracks"), {
        withFileTypes: true,
      })
        .filter((e) => e.isFile() && /\.(ya?ml|k7x)$/i.test(e.name))
        .map((e) => e.name.replace(/\.(ya?ml|k7x)$/i, ""))
        .sort();
    } catch {
      return []; // a song with no picture has no lanes, which is not an error
    }
  },
  // What `clip process` accepts — clips then audio files, and no track. See docs/completions.md.
  clipTargets: (h): string[] => [
    ...new Set(
      h
        .project()
        .tracks.flatMap((t) => t.clips)
        .filter((c) => c.type === "audio" && c.source)
        .map((c) => c.id),
    ),
    ...PROVIDERS.audioFiles(h),
  ],
  // The chains a bounce can run: this project's, then the médiathèque's `@st0/` ones, in one list.
  chains: (h) => chainNames(h.songPath, h.project()),
  // The project's curves, by id — read off disk, not off the document. See docs/completions.md.
  curves: (h) => {
    try {
      return Object.keys(loadCurves(h.songPath)).sort();
    } catch {
      return []; // a broken curve file costs the completion, not the command
    }
  },
  // The kinds of surface, from the OPEN registry rather than the schema's frozen enum — a
  // plugin's contribution completes like a builtin's. See packages/st0-sdk/docs/sdk.md.
  surfaceTypes: () => [...allSurfaceTypes()],
  // Sequence FILE ids, read off disk: a file id can differ from the midi-clip name it reports.
  sequenceFiles: (h) => {
    try {
      return readdirSync(join(h.songPath, "sequences"))
        .filter((f) => /\.(ya?ml|k7x)$/i.test(f))
        .map((f) => f.replace(/\.(ya?ml|k7x)$/i, ""));
    } catch {
      return [];
    }
  },
  // The samples a rack tap may play — exactly the list `node tap sample` accepts, `@<library>/<path>` and `@project/<path>`.
  samples: (h) => {
    try {
      return libraryFiles("samples", h.songPath).sort();
    } catch {
      return []; // no library cloned yet: nothing to offer, which is not an error
    }
  },
  // Audio files in the active project, walked per completion so new ones appear; hidden dirs are skipped.
  audioFiles: (h) => {
    const AUDIO_EXT = new Set([
      ".wav",
      ".aif",
      ".aiff",
      ".flac",
      ".mp3",
      ".ogg",
      ".m4a",
      ".opus",
    ]);
    const files: string[] = [];
    const walk = (dir: string) => {
      try {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          if (e.name.startsWith(".") || e.name === "node_modules") continue;
          const full = join(dir, e.name);
          if (e.isDirectory()) {
            walk(full);
            continue;
          }
          if (
            AUDIO_EXT.has(e.name.slice(e.name.lastIndexOf(".")).toLowerCase())
          )
            files.push(relative(h.songPath, full).split("\\").join("/"));
        }
      } catch {
        /* dir unreadable */
      }
    };
    walk(h.songPath);
    return files;
  },
} satisfies Record<string, (h: CommandHost) => string[]>;

/** The `menu:` words of one entry, unknown ones reported and dropped — a typo would silence a menu. */
function menuList(command: string, words: unknown[]): MenuEntity[] {
  const kept: MenuEntity[] = [];
  for (const w of words.map(String))
    if (MENU_NAMES.has(w)) kept.push(w as MenuEntity);
    else
      console.error(
        `commands.yaml: "${command}" menu: names an unknown entity "${w}" — ` +
          `known: ${MENU_ENTITIES.join(", ")}`,
      );
  return kept;
}

// commands.yaml ships beside the package root; this module is src/commandSpec.ts.
function commandsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "commands.yaml");
}

let cached: CommandSpec[] | null = null;
export function loadCommandSpecs(): CommandSpec[] {
  // Both arms merge the registered specs: the early return is the HOT one (every dispatch, every
  // completion), so a plugin verb that vanished once the yaml was cached would be the quiet kind.
  if (cached) return [...cached, ...registeredSpecs];
  try {
    const raw = parseYaml(wsRead(commandsPath()));
    cached = (Array.isArray(raw) ? raw : [])
      .filter((c: any) => c?.command && c?.sid)
      .map((c: any) => ({
        command: String(c.command),
        sid: String(c.sid),
        help: c.help ? String(c.help) : undefined,
        // Both languages or neither, so a French list never shows one English row in it.
        readable:
          c.readable?.en && c.readable?.fr
            ? { en: String(c.readable.en), fr: String(c.readable.fr) }
            : undefined,
        // An entry that names no surfaces runs everywhere.
        surfaces: Array.isArray(c.surfaces)
          ? (c.surfaces as Surface[])
          : ["cli"],
        // …and one that names no menu is offered on every menu its arguments fit.
        menu: Array.isArray(c.menu)
          ? menuList(String(c.command), c.menu as unknown[])
          : undefined,
        confirm: c.confirm === true ? true : undefined,
        args: Array.isArray(c.args)
          ? c.args.map((a: any) => {
              // An unknown provider is a typo: reported and dropped, never thrown — a throw here would empty the WHOLE catalogue.
              const want = a?.complete ? String(a.complete) : undefined;
              if (want && !PROVIDER_NAMES.has(want))
                console.error(
                  `commands.yaml: "${String(c.command)}" arg "${String(a?.name ?? "")}" ` +
                    `names an unknown completion provider "${want}" — known: ${[...PROVIDER_NAMES].join(", ")}`,
                );
              return {
                name: String(a?.name ?? ""),
                type: argKind(String(c.command), a),
                complete:
                  want && PROVIDER_NAMES.has(want)
                    ? (want as ProviderName)
                    : undefined,
                values: Array.isArray(a?.values)
                  ? a.values.map(String)
                  : undefined,
                hint: a?.hint ? String(a.hint) : undefined,
                optional: a?.optional === true ? true : undefined,
              };
            })
          : undefined,
      }));
  } catch {
    cached = [];
  }
  // The yaml is the BUILTINS' declarative home; a plugin's specs are registered in code, so both
  // merge here — every reader of the catalogue (the palette, the menus, the dispatch) sees them.
  return [...cached, ...registeredSpecs];
}

/** The catalogue a plugin added, merged at every read — see registerCommandSpec. */
const registeredSpecs: CommandSpec[] = [];

/** Add a plugin's verb to the catalogue: same shape as a yaml row, same treatment everywhere.
 *  A command word that is already spoken for is refused, not renamed — one word, one verb. */
export function registerCommandSpec(spec: CommandSpec): void {
  if (loadCommandSpecs().some((c) => c.command === spec.command))
    throw new Error(`command '${spec.command}' is already in the catalogue`);
  registeredSpecs.push(spec);
}

/** The ONE installer a plugin calls: the catalogue half AND the behaviour half, in one move —
 *  a spec whose SID dispatches is the whole verb, so contributing either alone would leave a
 *  half verb that reads but never runs (or runs and never reads). Both halves refuse an already
 *  spoken-for word, so a partially installed verb fails loudly at install, never at use. */
export function registerVerb(spec: CommandSpec, handler: SidHandler): void {
  registerCommandSpec(spec);
  registerCommand({ sid: spec.sid, handler });
}

// The provider names as a TYPE, so the vocabulary follows and a stale reference stops compiling.
export type ProviderName = keyof typeof PROVIDERS;

/** What a list shows beside a value that is not what a person reads, by provider — docs/completions.md. */
const PROVIDER_LABELS: Partial<
  Record<ProviderName, (h: CommandHost) => Record<string, string>>
> = {
  // A chain project's node is its uuid: shown as its module and its place, inserted as the uuid.
  nodes: (h) => {
    if (!h.songPath) return {};
    try {
      return Object.fromEntries(
        Object.entries(nodePlaces(h.songPath)).map(([n, p]) => [
          n,
          nodeCaption(p),
        ]),
      );
    } catch {
      return {}; // an unreadable chain file costs the label, not the completion
    }
  },
};

// The DISPLAY class of an argument, mirrored on the wire and kept in step by a test.
export const ARG_CLASSES = [
  "track",
  "module",
  "file",
  "marker",
  "choice",
  "timecode",
  "number",
  "note",
  "text",
] as const;
export type ArgClass = (typeof ARG_CLASSES)[number];

// Where a right-click may offer a command, mirrored on the wire — apps/st0/frontend/docs/contextMenu.md.
export const MENU_ENTITIES = [
  "track",
  "group",
  "node",
  "event",
  "param",
  "curve",
  "ruler",
  "marker",
  "assembly",
  "warp",
  "shot",
  "pad",
  "note",
  "tap",
] as const;
export type MenuEntity = (typeof MENU_ENTITIES)[number];
const MENU_NAMES: ReadonlySet<string> = new Set(MENU_ENTITIES);

// Which class each provider serves. Exhaustive over PROVIDERS, so a new one must say what it names to compile.
const PROVIDER_CLASS: Record<ProviderName, ArgClass> = {
  tracks: "track",
  moduleAlternatives: "choice",
  moduleEngines: "choice",
  // A clip id and an audio path are both material, which the palette colours as a file.
  clipTargets: "file",
  // A chain is neither a module nor anything on disk the `file` class would colour.
  chains: "choice",
  curves: "choice",
  modules: "module",
  // A node is drawn as a module is — it is one, in use — so the palette colours them alike.
  nodes: "module",
  baseModules: "module",
  engineModules: "module",
  categories: "module",
  markerNames: "marker",
  sequenceFiles: "file",
  audioFiles: "file",
  // A sample is a file, in a library's samples/ or the project's.
  samples: "file",
  // A playlist IS its file: no marker inside a folder, the extension is the whole rule.
  playlists: "file",
  // A lane IS its file too, the same way — video_tracks/<id>.yaml, and the id is the stem.
  pictureLanes: "file",
  // Not "file": the surface's file does not exist yet — naming its type is what creates it.
  surfaceTypes: "choice",
  // A box is not a module and not a file the palette would colour: it is one of a closed set of names.
  assemblies: "choice",
  // …and a template IS its folder in the library, named the way a module ref is.
  assemblyTemplates: "module",
};

export function argClass(a: ArgSpec): ArgClass {
  if (a.complete) return PROVIDER_CLASS[a.complete];
  if (a.values) return "choice";
  return a.type ?? "text";
}

// What each provider offers, at PROVIDER level: "a sequence" and "an audio file" are different answers.
const PROVIDER_HINT: Record<ProviderName, string> = {
  moduleAlternatives:
    "one of this module's alternatives — unnamed ones answer to their number",
  moduleEngines:
    "one of this module's engines — the folders under its engines/",
  tracks: "a track of this project",
  clipTargets:
    "a clip of this project, or one audio file (e.g. clips/kick.wav)",
  chains: "a chain of this project, or one the médiathèque holds (@st0/<path>)",
  curves: "an automation curve of this project (curves/<id>.yaml)",
  modules: "a module of this project",
  nodes: "a node of this project — one of its uses of a module",
  assemblies: "a box this project declares (assemblies/<name>.yaml)",
  assemblyTemplates:
    "an assembly template the library holds (@st0/<path>) — its nodes and wiring are copied in",
  baseModules:
    "the module to inherit from — this project's and the account's libraries",
  engineModules:
    "a plugin the engine scanned (@engine/<slug>) — it has no folder until one is given",
  categories:
    "<category>/<name> — the category decides the module's kind and its ports",
  markerNames: "a marker of this project",
  sequenceFiles: "a sequence of this project (sequences/<name>.yaml)",
  audioFiles: "an audio file of this project (e.g. clips/kick.wav)",
  samples:
    "a sample a library or this project holds under samples/ (@<library>/<path>, @project/<path>)",
  playlists: "a set list of this repository (_playlists/<name>.yaml)",
  pictureLanes: "a picture lane of this song (video_tracks/<id>.yaml)",
  surfaceTypes:
    "which view to draw — the arrangement, the frame, or the desk. Its layout follows.",
};

// What a scalar class accepts, for arguments with no provider and no hint — nothing else in the palette says it.
const CLASS_HINT: Record<ArgClass, string> = {
  timecode: "bar:beat:sixteenth — 5, 5:1, 5:1:1",
  number: "a number",
  note: "a note name (C4, F#3) or a MIDI number 0…127",
  choice: "", // its values ARE the clue — see argHint
  text: "", // free text: there is nothing to promise
  // The project-backed classes never reach here — their provider answers first.
  track: "",
  module: "",
  file: "",
  marker: "",
};

// The clue beside the field: the argument's own, else its provider's, else its set, else its class. Empty ⇒ none.
export function argHint(a: ArgSpec): string {
  if (a.hint) return a.hint;
  if (a.complete) return PROVIDER_HINT[a.complete];
  if (a.values) return a.values.join(" · ");
  return CLASS_HINT[argClass(a)];
}

export const ARG_KIND_NAMES: ReadonlySet<string> = new Set([
  "timecode",
  "number",
  "note",
]);

// Read an argument's declared shape; an unknown one is reported and KEPT, so the test suite fails on the typo.
function argKind(
  command: string,
  a: { name?: unknown; type?: unknown },
): ArgKind | undefined {
  if (a?.type === undefined) return undefined;
  const kind = String(a.type);
  if (!ARG_KIND_NAMES.has(kind))
    console.error(
      `commands.yaml: "${command}" arg "${String(a?.name ?? "")}" names an ` +
        `unknown type "${kind}" — known: ${[...ARG_KIND_NAMES].join(", ")}`,
    );
  return kind as ArgKind;
}

// Check one token against its shape; the timecode parses at 4/4 on purpose, docs/completions.md.
function argError(kind: ArgKind, name: string, token: string): string | null {
  switch (kind) {
    case "timecode":
      try {
        parsePosition(token, 4, 4);
        return null;
      } catch {
        return `<${name}> expects a bar:beat:sixteenth position (5, 5:1, 5:1:1) — got "${token}"`;
      }
    case "number":
      return Number.isFinite(Number(token))
        ? null
        : `<${name}> expects a number — got "${token}"`;
    case "note":
      return parseMidiNote(token) === null
        ? `<${name}> expects a note name (C4, F#3) or a MIDI number 0..127 — got "${token}"`
        : null;
    default:
      return null; // unknown kind: already reported at load, don't block the command
  }
}

// The first argument that doesn't fit, walking declared args POSITIONALLY — docs/completions.md.
export function validateArgs(
  spec: CommandSpec,
  userArgs: string,
): string | null {
  if (!spec.args?.length || !userArgs) return null;
  const tokens = userArgs.split(/\s+/);
  for (let i = 0; i < spec.args.length && i < tokens.length; i++) {
    const a = spec.args[i];
    if (!a.type) continue;
    const err = argError(a.type, a.name, tokens[i]);
    if (err) return err;
  }
  return null;
}
// Exported so a test can hold commands.yaml to it — see commandSpec.test.ts.
export const PROVIDER_NAMES: ReadonlySet<string> = new Set(
  Object.keys(PROVIDERS),
);

const forSurface = (surface: Surface): CommandSpec[] =>
  loadCommandSpecs().filter((c) => c.surfaces.includes(surface));

/** One completion: the LINE it completes to, and what a list may show for its value instead. */
export interface CompletionItem {
  line: string;
  label?: string;
}

// Autocomplete: the token under the cursor picks its ArgSpec BY POSITION, earlier ones echoed.
export function completions(
  line: string,
  host: CommandHost,
  surface: Surface,
): string[] {
  return completionItems(line, host, surface).map((c) => c.line);
}

/** …the same candidates, each with its label when its provider gives one (docs/completions.md). */
export function completionItems(
  line: string,
  host: CommandHost,
  surface: Surface,
): CompletionItem[] {
  const s = line.replace(/^\s+/, "");
  const specs = forSurface(surface);
  // Pick the command the way runCommand does — LONGEST prefix — so completion offers args for what will run.
  const spec = specs
    .filter((c) => s.startsWith(`${c.command} `))
    .sort((a, b) => b.command.length - a.command.length)[0];
  if (spec) {
    // A trailing space starts a new empty token, which split keeps as a final "" and completes to every next value.
    const tokens = s.slice(spec.command.length + 1).split(/\s+/);
    const i = tokens.length - 1;
    const partial = tokens[i];
    const arg = spec.args?.[i];
    // A literal set answers for itself; a provider is asked. Either way the shape is the same list of candidate values.
    const values = arg?.values
      ? () => arg.values as string[]
      : arg?.complete
        ? PROVIDERS[arg.complete]
        : undefined;
    if (!values) return [];
    const prefix = [spec.command, ...tokens.slice(0, i)].join(" ");
    const labels = arg?.complete ? PROVIDER_LABELS[arg.complete]?.(host) : {};
    return values(host)
      .filter((v) => v.toLowerCase().startsWith(partial.toLowerCase()))
      .map((v) => ({
        line: `${prefix} ${v}`,
        ...(labels?.[v] ? { label: labels[v] } : {}),
      }));
  }
  return specs
    .filter((c) => c.command.startsWith(s) && c.command !== s)
    .map((c) => ({ line: c.command }));
}

// Dispatch a line: longest-prefix match, prepend fixed args, run the handler. Nothing dispatched is a refusal.
export async function runCommand(
  line: string,
  host: CommandHost,
  surface: Surface,
): Promise<void> {
  const s = line.trim();
  const spec = forSurface(surface)
    .filter((c) => s === c.command || s.startsWith(`${c.command} `))
    .sort((a, b) => b.command.length - a.command.length)[0];
  if (!spec) {
    host.refuse([`unknown command: ${s}`]);
    return;
  }
  const handler = SID_HANDLERS[spec.sid];
  if (!handler) {
    host.refuse([`command '${spec.command}' has no handler (${spec.sid})`]);
    return;
  }
  const userArgs = s.slice(spec.command.length).trim();
  // Shape-check before the handler, so a mistyped timecode says what it should look like, not "no event at xyz".
  const bad = validateArgs(spec, userArgs);
  if (bad) {
    host.refuse([`${spec.command}: ${bad}`]);
    return;
  }
  await handler(userArgs, host);
}
