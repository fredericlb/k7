// rankCommands.ts — the command bar's ranking of a catalogue against what was typed, importing no catalogue.
// Apart from palette.ts, which imports the editor's whole command registry, so the home page's bar loads only its own verbs.

import type { PaletteCommand } from "./components/CommandBar";
import { fuzzyScore } from "./fuzzy";
import { MAX_RECENT } from "./recentCommands";

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
