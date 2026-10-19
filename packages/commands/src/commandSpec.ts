// commandSpec.ts — the declarative half of the command layer: commands.yaml maps what you
// TYPE ("module new") to a feature SID, plus fixed args, an argument/completion spec, and
// the surfaces it appears on. Drives both completions() and runCommand(), shared by the
// web editor and the CLI; the behaviours live in verbs/, the completion providers in providers.ts.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProjectFormat } from "@studio/song/loader";
import { parsePosition } from "@studio/song-schema/timecode";
import { parse as parseYaml } from "yaml";
import {
  type CommandHost,
  parseMidiNote,
  registerCommand,
  SID_HANDLERS,
  type SidHandler,
} from "./commands";
import {
  type ArgClass,
  CLASS_HINT,
  PROVIDER_CLASS,
  PROVIDER_HINT,
  PROVIDER_LABELS,
  PROVIDER_NAMES,
  PROVIDERS,
  type ProviderName,
} from "./providers";
import { soundingLaneRefusal } from "./verbs/pictureSound";

// One surface — the web backend dispatches under "cli" too — but it stays a type.
export type Surface = "cli";

// A scalar shape checked before the handler, for ONE-token arguments only — docs/completions.md.
type ArgKind = "timecode" | "number" | "note";

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
interface ReadableDescription {
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
  // Both arms merge the registered specs, the cached one above all: it serves every dispatch and completion.
  if (cached) return [...cached, ...registeredSpecs];
  try {
    const raw = parseYaml(readFileSync(commandsPath(), "utf8"));
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
  // The yaml holds the builtins and a plugin registers in code; every reader of the catalogue sees both.
  return [...cached, ...registeredSpecs];
}

/** The catalogue a plugin added, merged at every read — see registerCommandSpec. */
const registeredSpecs: CommandSpec[] = [];

/** Add a plugin's verb to the catalogue like a yaml row; a word already spoken for is refused, never renamed. */
function registerCommandSpec(spec: CommandSpec): void {
  if (loadCommandSpecs().some((c) => c.command === spec.command))
    throw new Error(`command '${spec.command}' is already in the catalogue`);
  registeredSpecs.push(spec);
}

/** The ONE installer a plugin calls: catalogue and behaviour in one move, so a half verb fails at install — docs/verbs.md. */
export function registerVerb(spec: CommandSpec, handler: SidHandler): void {
  // Both refusals run before either half is written, so a clash leaves no catalogue row behind.
  if (SID_HANDLERS[spec.sid])
    throw new Error(`command '${spec.sid}' already has a handler`);
  registerCommandSpec(spec);
  registerCommand({ sid: spec.sid, handler });
}

// Where a right-click may offer a command, mirrored on the wire — apps/k7/frontend/docs/contextMenu.md.
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
type MenuEntity = (typeof MENU_ENTITIES)[number];
const MENU_NAMES: ReadonlySet<string> = new Set(MENU_ENTITIES);

export function argClass(a: ArgSpec): ArgClass {
  if (a.complete) return PROVIDER_CLASS[a.complete];
  if (a.values) return "choice";
  return a.type ?? "text";
}

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
  // A project of a newer format is edited by no verb, since several write its root without reading it.
  try {
    if (host.songPath) checkProjectFormat(host.songPath);
  } catch (e) {
    host.refuse([(e as Error).message]);
    return;
  }
  // Once here rather than in every event verb, each of which finds its clip its own way.
  const sounding = soundingLaneRefusal(spec, userArgs, host.songPath);
  if (sounding) {
    host.refuse([sounding]);
    return;
  }
  await handler(userArgs, host);
}
