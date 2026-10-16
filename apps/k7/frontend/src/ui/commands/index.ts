// index.ts — the ONE table of the shell's own commands: each entry is its palette row (name,
// sentence, arguments) and its behaviour. The palette's catalogue and the `ui` gate's lists are
// derived from it, so a command cannot be listed without being dispatched, or the reverse.

import type { PaletteArg } from "../../components/CommandBar";
import { ARMING_COMMANDS } from "./arming";
import type { LocalCommand } from "./context";
import { EDITOR_COMMANDS } from "./editors";
import { FILE_COMMANDS } from "./files";
import { PANEL_COMMANDS } from "./panels";
import { PROJECT_COMMANDS } from "./project";
import { TIMELINE_COMMANDS } from "./timeline";
import { TRANSPORT_COMMANDS } from "./transport";
import { VIEW_COMMANDS } from "./views";

export type { LocalCommand, LocalCtx } from "./context";

/** Every command the shell answers itself, in the order the palette lists them. */
export const LOCAL_REGISTRY: readonly LocalCommand[] = [
  ...VIEW_COMMANDS,
  ...PANEL_COMMANDS,
  ...EDITOR_COMMANDS,
  ...ARMING_COMMANDS,
  ...TIMELINE_COMMANDS,
  ...TRANSPORT_COMMANDS,
  ...FILE_COMMANDS,
  ...PROJECT_COMMANDS,
];

/** Is this a view command — named under `ui`, and dispatched only with that prefix? */
export const isUiCommand = (c: LocalCommand): boolean =>
  c.name.startsWith("ui ");

/** What the dispatcher matches: the name with its `ui ` prefix stripped. */
export const dispatchKey = (c: LocalCommand): string =>
  isUiCommand(c) ? c.name.slice("ui ".length) : c.name;

/** How a line must spell the key: whole, followed by arguments, or either. */
export const matchOf = (c: LocalCommand): "exact" | "head" | "names" =>
  c.match ?? (c.args?.length ? "head" : "exact");

const matches = (c: LocalCommand, line: string): boolean => {
  const key = dispatchKey(c);
  const how = matchOf(c);
  return (
    (how !== "head" && line === key) ||
    (how !== "exact" && line.startsWith(`${key} `))
  );
};

/** The command a stripped, lowercased line names on its side of the `ui` gate — the longest key wins. */
export function findLocal(line: string, ui: boolean): LocalCommand | null {
  let best: LocalCommand | null = null;
  for (const c of LOCAL_REGISTRY)
    if (
      isUiCommand(c) === ui &&
      matches(c, line) &&
      (!best || dispatchKey(c).length > dispatchKey(best).length)
    )
      best = c;
  return best;
}

const listed = LOCAL_REGISTRY.filter((c) => c.listed !== false);

/** The palette's names for the shell's own commands. */
export const LOCAL_COMMANDS: string[] = listed.map((c) => c.name);

/** What each one does, as a sentence per language — imperative, no example, no full stop, 60 characters at most. */
export const LOCAL_READABLE: Record<string, { en: string; fr: string }> =
  Object.fromEntries(
    listed.flatMap((c) => (c.readable ? [[c.name, c.readable]] : [])),
  );

/** The trailing params of each; `kind` is what the param NAMES, and colours the field. */
export const LOCAL_ARGS: Record<string, PaletteArg[]> = Object.fromEntries(
  listed.flatMap((c) => (c.args?.length ? [[c.name, c.args]] : [])),
);
