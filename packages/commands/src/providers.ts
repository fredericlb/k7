// providers.ts — the named completion providers behind commands.yaml's `complete:`, and
// what the palette shows for each: a label beside a value, the argument's display class,
// and its one-line hint. Read by commandSpec.ts; see docs/completions.md.

import { type Dirent, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { chainNames } from "@studio/audio-passes/processChain";
import { libraryAssemblies, projectAssemblies } from "@studio/song/assemblies";
import { loadCurves } from "@studio/song/curves";
import { nodeCaption, nodePlaces } from "@studio/song/graph";
import { libraryFiles } from "@studio/song/libraryFiles";
import { loadModuleRefs, loadModules, MODULE_TYPES } from "@studio/song/loader";
import { accountLibraries } from "@studio/song/sharedFolders";
import { isDocName } from "@studio/song/yaml/workspaceFile";
import { alternativesOf } from "@studio/song-schema/alternatives";
import { stripDocExt } from "@studio/song-schema/docExt";
import {
  completionOrder,
  isEngineRef,
  type ModuleStatus,
  moduleStatusOf,
} from "@studio/song-schema/moduleTypes";
import { PLAYLISTS_DIR } from "@studio/song-schema/playlist";
import { allSurfaceTypes } from "@studio/song-schema/yaml/surfaceRegistry";
import { type CommandHost, collectPluginModules } from "./commands";

/** Each module's `status:`, off the ref map, for the providers that rank by it — docs/completions.md. */
export function moduleStatuses(h: CommandHost): (name: string) => ModuleStatus {
  let refs: Record<string, unknown> = {};
  try {
    if (h.songPath) refs = loadModuleRefs(h.songPath);
  } catch {
    /* no ranking, still a complete list */
  }
  return (name) => moduleStatusOf(refs[name]);
}

// Named providers behind commands.yaml `complete:`; `satisfies` is load-bearing, docs/completions.md.
export const PROVIDERS = {
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
  /** The origin's libraries this machine holds, by name. */
  libraries: () => accountLibraries().map((l) => l.name),
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
        else if (e.isFile() && isDocName(e.name)) out.push(stripDocExt(name));
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
        .filter((e) => e.isFile() && isDocName(e.name))
        .map((e) => stripDocExt(e.name))
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
  // The chains a bounce can run: this project's, then the médiathèque's `@k7-core/` ones, in one list.
  chains: (h) => chainNames(h.songPath, h.project()),
  // The project's curves, by id — read off disk, not off the document. See docs/completions.md.
  curves: (h) => {
    try {
      return Object.keys(loadCurves(h.songPath)).sort();
    } catch {
      return []; // a broken curve file costs the completion, not the command
    }
  },
  // The OPEN registry, not the schema's enum, so a plugin's surface completes like a builtin's (packages/k7-sdk/docs/sdk.md).
  surfaceTypes: () => [...allSurfaceTypes()],
  // Sequence FILE ids, read off disk: a file id can differ from the midi-clip name it reports.
  sequenceFiles: (h) => {
    try {
      return readdirSync(join(h.songPath, "sequences"))
        .filter((f) => isDocName(f))
        .map(stripDocExt);
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

// The provider names as a TYPE, so the vocabulary follows and a stale reference stops compiling.
export type ProviderName = keyof typeof PROVIDERS;

/** What a list shows beside a value that is not what a person reads, by provider — docs/completions.md. */
export const PROVIDER_LABELS: Partial<
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

// Which class each provider serves. Exhaustive over PROVIDERS, so a new one must say what it names to compile.
export const PROVIDER_CLASS: Record<ProviderName, ArgClass> = {
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
  // A library is a name from the origin's list, not a path.
  libraries: "choice",
  // A lane IS its file too, the same way — video_tracks/<id>.yaml, and the id is the stem.
  pictureLanes: "file",
  // Not "file": the surface's file does not exist yet — naming its type is what creates it.
  surfaceTypes: "choice",
  // A box is not a module and not a file the palette would colour: it is one of a closed set of names.
  assemblies: "choice",
  // …and a template IS its folder in the library, named the way a module ref is.
  assemblyTemplates: "module",
};

// What each provider offers, at PROVIDER level: "a sequence" and "an audio file" are different answers.
export const PROVIDER_HINT: Record<ProviderName, string> = {
  moduleAlternatives:
    "one of this module's alternatives — unnamed ones answer to their number",
  moduleEngines:
    "one of this module's engines — the folders under its engines/",
  tracks: "a track of this project",
  clipTargets:
    "a clip of this project, or one audio file (e.g. clips/kick.wav)",
  chains:
    "a chain of this project, or one the médiathèque holds (@k7-core/<path>)",
  curves: "an automation curve of this project (curves/<id>.yaml)",
  modules: "a module of this project",
  nodes: "a node of this project — one of its uses of a module",
  assemblies: "a box this project declares (assemblies/<name>.yaml)",
  assemblyTemplates:
    "an assembly template the library holds (@k7-core/<path>) — its nodes and wiring are copied in",
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
  libraries:
    "one of the origin's libraries, as its refs name it (@<library>/…)",
  pictureLanes: "a picture lane of this song (video_tracks/<id>.yaml)",
  surfaceTypes:
    "which view to draw — the arrangement, the frame, or the desk. Its layout follows.",
};

// What a scalar class accepts, for arguments with no provider and no hint — nothing else in the palette says it.
export const CLASS_HINT: Record<ArgClass, string> = {
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

// Exported so a test can hold commands.yaml to it — see commandSpec.test.ts.
export const PROVIDER_NAMES: ReadonlySet<string> = new Set(
  Object.keys(PROVIDERS),
);
