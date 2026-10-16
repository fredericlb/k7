// localCommands.ts — WHICH lines the shell answers itself, and under which namespace. Both
// lists are derived from the command registry (ui/commands/), so the `ui` gate and the palette
// cannot disagree; what is here is the gate's own logic, small enough to test alone.

import { dispatchKey, isUiCommand, LOCAL_REGISTRY } from "./ui/commands/index";

export { BARE_TRANSPORT } from "./ui/commands/transport";

const uiCommands = LOCAL_REGISTRY.filter(isUiCommand);

/** `ui` promises: touches nothing of the PROJECT, moves no transport — and the pairing is enforced BOTH ways (docs/shell.md). */
export const UI_EXACT: readonly string[] = uiCommands
  .filter((c) => !c.args?.length)
  .map(dispatchKey);

/** The `ui` ones that take an argument, so they match on their head rather than whole. */
export const UI_HEADS: readonly string[] = uiCommands
  .filter((c) => c.args?.length)
  .map((c) => `${dispatchKey(c)} `);

/** Does `line` name this command? Whole-word, so a bare `fs file new` from an unfilled form reaches the same branch as the full line. */
const namesLine = (line: string, name: string): boolean =>
  line === name || line.startsWith(`${name} `);

const heads = (line: string, names: readonly string[]): boolean =>
  names.some((n) => namesLine(line, n.trimEnd()));

/** Does this line — stripped of any `ui ` prefix and lowercased — name a `ui` command? One list of exact names, one of heads. */
export const isUiLine = (line: string): boolean =>
  UI_EXACT.includes(line) || heads(line, UI_HEADS);

/** Who answers a line — `ui`, a refusal, or the server (`pass`), which keeps an unprefixed line it names: docs/shell.md. */
export function uiVerdict(
  line: string,
  prefixed: boolean,
  isServerCommand: (line: string) => boolean,
): "ui" | "refuse" | "pass" {
  const ui = isUiLine(line);
  if (prefixed) return ui ? "ui" : "refuse";
  if (!ui) return "pass";
  return isServerCommand(line) ? "pass" : "refuse";
}
