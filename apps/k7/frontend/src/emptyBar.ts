// emptyBar.ts — what the command bar lists when it has the keyboard and nothing typed: a few
// commands you ran lately, then a few starters, never the catalogue (docs/commandBar.md).
// The one thing a reader would get wrong: a starter is offered only if THIS project's catalogue holds it.

import type { PaletteCommand } from "./components/CommandBar";

/** How many recent commands the empty bar offers — a glance, not the twelve-entry history. */
export const EMPTY_RECENT_MAX = 5;

/** The first verbs a newcomer needs: make a lane, find a file, see the mix, read the help. */
export const STARTER_COMMANDS: readonly string[] = [
  "track new",
  "ui file",
  "ui mixer",
  "ui help",
];

export interface EmptyBarRow {
  command: PaletteCommand;
  /** Recent rather than a starter — the bar heads each group with its own word. */
  recent: boolean;
}

/** The recents the catalogue still holds, most recent first, then the starters not already listed. */
export function emptyBarRows(
  commands: readonly PaletteCommand[],
  recent: readonly string[],
  starters: readonly string[] = STARTER_COMMANDS,
): EmptyBarRow[] {
  const byName = new Map(commands.map((c) => [c.canonical, c]));
  const rows: EmptyBarRow[] = [];
  const seen = new Set<string>();
  for (const name of recent) {
    if (rows.length >= EMPTY_RECENT_MAX) break;
    const c = byName.get(name);
    if (!c || seen.has(name)) continue;
    seen.add(name);
    rows.push({ command: c, recent: true });
  }
  for (const name of starters) {
    const c = byName.get(name);
    if (!c || seen.has(name)) continue;
    seen.add(name);
    rows.push({ command: c, recent: false });
  }
  return rows;
}
