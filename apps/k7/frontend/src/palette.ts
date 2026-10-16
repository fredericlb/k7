// palette.ts — the palette's catalogue (the backend's commands plus the shell's own, whose
// table is ui/commands/), the fuzzy ranking the bar lists by, and each argument's vocabulary.
// Apart from the shell because everything here is a pure function of the backend's catalogue
// plus a `files()` getter, with no shell state. See docs/commandBar.md.

import type { Completion } from "@studio/project-shell/project";
import { docPattern, stripDocExt } from "@studio/song-schema/docExt";
import { api } from "./api";
import { type ArgOption, optionsFromCompletions } from "./argOptions";
import type { PaletteArg, PaletteCommand } from "./components/CommandBar";
import { MIX_FORMATS, TIMELINE_FORMATS, VIDEO_FORMATS } from "./exportArgs";
import { fuzzyScore } from "./fuzzy";
import { MAX_RECENT } from "./recentCommands";
import { ROLL_MODES } from "./rollMode";
import { TOOLS } from "./timelineTools";
import type { CommandInfo, MenuEntity } from "./types";
import {
  LOCAL_ARGS,
  LOCAL_COMMANDS,
  LOCAL_READABLE,
} from "./ui/commands/index";
import { WAVE_MODES } from "./waveMode";

const MODULE_FILE = docPattern("(^|/)module");
const CURVE_FILE = docPattern("(^|/)curves/[^/]+");
const CLIP_FILE = docPattern("(^|/)clips/[^/]+");

export {
  type ArgOption,
  optionsFromCompletions,
  rankOptions,
  rankValues,
  toOptions,
} from "./argOptions";

// The shell's own commands, their sentences and their arguments: one registry, ui/commands/.
export {
  LOCAL_ARGS,
  LOCAL_COMMANDS,
  LOCAL_READABLE,
} from "./ui/commands/index";

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
    label: canonical,
    names: [canonical],
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
    const canonical = command.trim();
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
      if (first) return ["audio", "video", "timeline"];
      // The format depends on the half: a video has a container and a third word, the cut an interchange format.
      if (priorArgs.length === 1)
        return priorArgs[0] === "video"
          ? [...VIDEO_FORMATS]
          : priorArgs[0] === "timeline"
            ? [...TIMELINE_FORMATS]
            : [...MIX_FORMATS];
      if (priorArgs.length === 2 && priorArgs[0] === "video")
        return [...MIX_FORMATS, "none"];
      return [];
    }
    if (canonical === "fs file upload" && !first) return ["files", "folder"];
    // …and the ones that are the project's, but that only this app can answer.
    if (canonical === "ui external" && first) return shell.surfaces();
    if (canonical === "ui file" && first) return shell.files();
    if (canonical === "ui builder" && first)
      return shell.files().filter((f) => MODULE_FILE.test(f));
    // A curve is named by its id, its file's basename, as a clip is below.
    if (canonical === "ui curve" && first)
      return shell
        .files()
        .filter((f) => CURVE_FILE.test(f))
        .map((f) => stripDocExt(f.split("/").pop() ?? f));
    // The review takes a clip ID, not a path, so the tree is filtered to clips/ and the basename handed back, which is what the id IS.
    if (canonical === "ui review" && first)
      return shell
        .files()
        .filter((f) => CLIP_FILE.test(f))
        .map((f) => stripDocExt(f.split("/").pop() ?? f));
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
