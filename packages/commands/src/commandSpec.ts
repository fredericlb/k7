// commandSpec.ts — the declarative half of the command layer: commands.yaml maps what you
// TYPE ("module new") to a feature SID, plus fixed args, an argument/completion spec, and
// the surfaces it appears on. Drives both completions() and runCommand(), shared by the
// web editor and the CLI; the behaviours themselves live in commands.ts.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModuleRefs, loadModules, MODULE_TYPES } from "@studio/song/loader";
import { moduleAssetChoices } from "@studio/song/moduleAssetChoices";
import { parsePosition } from "@studio/song/timecode";
import { parse as parseYaml } from "yaml";
import {
  type CommandHost,
  collectPluginModules,
  parseMidiNote,
  SID_HANDLERS,
} from "./commands";
import { alternatives } from "./git";
import { chainNames } from "./processChain";

// The surfaces a command can appear on. Only one remains — the web backend dispatches under "cli" too — but it
// stays a type so a future surface needing its own subset has somewhere to hook in.
export type Surface = "cli";

// How an argument gets its values: a named provider, a literal set, or a scalar `type` checked before the handler.
// Only for ONE-token arguments — an argument that swallows the rest of the line stays the handler's business.
export type ArgKind = "timecode" | "number" | "note";

export interface ArgSpec {
  name: string;
  // The value's shape. Absent = free text, validated (if at all) by the handler.
  type?: ArgKind;
  // A named provider, checked against PROVIDERS at load, so a typo is reported rather than completing nothing.
  complete?: ProviderName;
  // …or a literal set written in the yaml. These used to be free text, so the palette asked what it already knew.
  values?: string[];
  // A one-line clue about what this argument ACCEPTS — worth writing when the class's own clue doesn't say enough.
  hint?: string;
  // TRAILING args only: the line runs without it. Several hints already said "optional" in prose, which told a
  // reader and not the palette — so a form could never know it had collected enough. See docs/optionalArgs.md.
  optional?: boolean;
}
export interface CommandSpec {
  command: string; // the typed prefix (may contain spaces/colons)
  sid: string;
  help?: string;
  surfaces: Surface[];
  with?: string[]; // fixed leading args passed to the handler (e.g. module list vst -> ["vst"])
  args?: ArgSpec[]; // trailing user args (for completion)
}

// Named completion providers referenced by commands.yaml `complete:`, reading live state off the host.
const PROVIDERS: Record<string, (h: CommandHost) => string[]> = {
  baseModules: (h) => h.baseModules,
  // The module category folders, each with a trailing "/" so completing drops you ready to type the name.
  categories: () => Object.keys(MODULE_TYPES).map((c) => `${c}/`),
  // The blocks a chain can use: the project's own, plus the INHERITED modules by ref —
  // those are nameable before any chain has used one, so they can't come off the project.
  modules: (h) => [
    ...collectPluginModules(h.project()).map((b) => b.module),
    ...h.baseModules.filter((r) => r.startsWith("@")),
  ],
  tracks: (h) => h.project().tracks.map((t) => t.id),
  // The branches you can switch to — every local one EXCEPT the one you are on, which is
  // not a destination. Best-effort: no repo means nothing to offer, not an error.
  alternatives: (h) => {
    const dir = h.repoDir ?? h.songPath;
    if (!dir) return [];
    try {
      return alternatives(dir, h.gitEnv)
        .branches.filter((b) => !b.current)
        .map((b) => b.name);
    } catch {
      return [];
    }
  },
  // Marker names for `marker delete`. A multi-word name doesn't complete cleanly, but single-word ones do.
  markerNames: (h) => h.project().markers.map((m) => m.name),
  // What `clip process` accepts: the audio clips this project places, then its audio files —
  // for material no clip file has claimed yet. Tracks are deliberately absent, and the handler
  // refuses one by name: `track process` is the command for those. Clip ids were dropped from a
  // list like this once, back when the command reading it resolved only a track or a path, and
  // the rule that did it stands unchanged — never offer what the command would reject.
  clipTargets: (h) => [
    ...new Set(
      h
        .project()
        .tracks.flatMap((t) => t.clips)
        .filter((c) => c.type === "audio" && c.source)
        .map((c) => c.id),
    ),
    ...PROVIDERS.audioFiles(h),
  ],
  // The chains a bounce can run: this project's, then the médiathèque's under `@mediatek/`.
  // Both in one list because the command takes either — see processChain.ts.
  chains: (h) => chainNames(h.project()),
  // Sequence FILE ids, read off disk: a sequence's file id can differ from the midi-clip name collectSequences reports.
  sequenceFiles: (h) => {
    try {
      return readdirSync(join(h.songPath, "sequences"))
        .filter((f) => /\.ya?ml$/i.test(f))
        .map((f) => f.replace(/\.ya?ml$/i, ""));
    } catch {
      return [];
    }
  },
  // Every module's own assets at once, as assets-relative paths, plus `none` to clear. Not
  // narrowed to the module being edited: the completion runs before that argument is typed,
  // and a project's modules carry a handful of files each, not a library's worth.
  assetFiles: (h) => {
    // Read once, then asked per module: `moduleAssetChoices` walks each module's ancestry, so a
    // thin local module extending a médiathèque amp offers that amp's profiles rather than the
    // empty list its own folder holds.
    const refs = (() => {
      try {
        return loadModuleRefs(h.songPath);
      } catch {
        return {};
      }
    })();
    return [
      ...new Set(
        Object.values(loadModules(h.songPath)).flatMap((m) =>
          moduleAssetChoices(h.songPath, m, refs),
        ),
      ),
      "none",
    ];
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
};

// commands.yaml ships beside the package root; this module is src/commandSpec.ts.
function commandsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "commands.yaml");
}

let cached: CommandSpec[] | null = null;
export function loadCommandSpecs(): CommandSpec[] {
  if (cached) return cached;
  try {
    const raw = parseYaml(readFileSync(commandsPath(), "utf8"));
    cached = (Array.isArray(raw) ? raw : [])
      .filter((c: any) => c?.command && c?.sid)
      .map((c: any) => ({
        command: String(c.command),
        sid: String(c.sid),
        help: c.help ? String(c.help) : undefined,
        // An entry that names no surfaces runs everywhere.
        surfaces: Array.isArray(c.surfaces)
          ? (c.surfaces as Surface[])
          : ["cli"],
        with: Array.isArray(c.with) ? c.with.map(String) : undefined,
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
  return cached;
}

// The provider names as a TYPE, so the vocabulary follows and a stale reference stops compiling.
export type ProviderName = keyof typeof PROVIDERS;

// The DISPLAY class of an argument — what KIND of thing it names, in one word, so a command line reads as a
// coloured sentence. A coarsening of the three vocabularies. Mirrored on the wire; a test keeps the two in step.
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
const PROVIDER_CLASS: Record<ProviderName, ArgClass> = {
  tracks: "track",
  // A named thing picked from a closed list — the same shape the palette renders for any
  // other choice. Not "file": an alternative is a branch, and nothing on disk.
  alternatives: "choice",
  // A clip id and an audio path are both material, and the palette colours material as a file —
  // the same answer `sequenceFiles` gets, whose ids are likewise entities rather than paths.
  clipTargets: "file",
  // A chain is a named thing picked from a closed list, like an alternative — it is neither a
  // module nor anything on disk the `file` class would colour.
  chains: "choice",
  modules: "module",
  baseModules: "module",
  categories: "module",
  markerNames: "marker",
  sequenceFiles: "file",
  audioFiles: "file",
  assetFiles: "file",
};

export function argClass(a: ArgSpec): ArgClass {
  if (a.complete) return PROVIDER_CLASS[a.complete];
  if (a.values) return "choice";
  return a.type ?? "text";
}

// What each provider offers, at PROVIDER level: "a sequence" and "an audio file" are different answers.
const PROVIDER_HINT: Record<ProviderName, string> = {
  alternatives: "an existing alternative — the one you are on is not offered",
  tracks: "a track of this project",
  clipTargets:
    "a clip of this project, or one audio file (e.g. clips/kick.wav)",
  chains:
    "a chain of this project, or one the médiathèque holds (@mediatek/<path>)",
  modules: "a module of this project",
  baseModules:
    "the module to inherit from — the engine's catalogue and this project's",
  categories:
    "<category>/<name> — the category decides the module's kind and its ports",
  markerNames: "a marker of this project",
  assetFiles: "a file the module carries, in its own assets/ folder",
  sequenceFiles: "a sequence of this project (sequences/<name>.yaml)",
  audioFiles: "an audio file of this project (e.g. clips/kick.wav)",
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

// Check one token against its shape. 4/4 on purpose: this checks the FORM of a timecode, and asking the host
// for the real signature would compile the project just to reject a typo.
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

// The first argument that doesn't fit, walking declared args POSITIONALLY. Extra tokens are the rest-of-line an
// argument may swallow; missing ones are the handler's to report, with its own usage line.
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

// Autocomplete: inside a command the token under the cursor picks its ArgSpec BY POSITION, so a command whose
// interesting argument isn't first still completes. Earlier tokens are echoed, so a suggestion is a runnable line.
export function completions(
  line: string,
  host: CommandHost,
  surface: Surface,
): string[] {
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
    return values(host)
      .filter((v) => v.toLowerCase().startsWith(partial.toLowerCase()))
      .map((v) => `${prefix} ${v}`);
  }
  return specs
    .filter((c) => c.command.startsWith(s) && c.command !== s)
    .map((c) => c.command);
}

// Dispatch a line: longest-prefix match, prepend fixed args, run the handler. Unknown goes to host.log.
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
    host.log([`unknown command: ${s}`]);
    return;
  }
  const handler = SID_HANDLERS[spec.sid];
  if (!handler) {
    host.log([`command '${spec.command}' has no handler (${spec.sid})`]);
    return;
  }
  const userArgs = s.slice(spec.command.length).trim();
  // Shape-check before the handler, so a mistyped timecode says what it should look like, not "no event at xyz".
  const bad = validateArgs(spec, userArgs);
  if (bad) {
    host.log([`${spec.command}: ${bad}`]);
    return;
  }
  const args = [...(spec.with ?? []), userArgs]
    .filter((a) => a !== "")
    .join(" ");
  await handler(args, host);
}
