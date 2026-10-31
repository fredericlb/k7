// stepSentence.ts — an undo journal step as a person reads it: the catalogue's `readable` sentence
// for the command the step ran, in the app's language, followed by its subject — the first
// argument, a lane or a clip by its shown name. A label that is no catalogue command is returned
// as written. Pure: the catalogue and the namers are passed in. See docs/shell.md, "Ctrl+Z".

import type { MenuNamers } from "./menuTitle";
import type { ArgProvider, CommandInfo } from "./types";

// A JSON-quoted token, as the shell writes an argument holding a space, or a bare run of non-space.
const TOKEN = /"(?:[^"\\]|\\.)*"|\S+/g;

const unquote = (t: string): string => {
  if (!t.startsWith('"')) return t;
  try {
    return JSON.parse(t) as string;
  } catch {
    return t;
  }
};

/** The providers whose value a namer turns into what the screen shows. */
const LANES: ReadonlySet<ArgProvider> = new Set(["tracks", "pictureLanes"]);
const CLIPS: ReadonlySet<ArgProvider> = new Set([
  "sequenceFiles",
  "clipTargets",
]);

/** The catalogue command a line runs — the one whose words begin it, the longest winning. */
export function commandOf(
  tokens: readonly string[],
  commands: readonly CommandInfo[],
): CommandInfo | undefined {
  let best: CommandInfo | undefined;
  let bestLen = 0;
  for (const c of commands) {
    const words = c.command.split(" ");
    if (words.length <= bestLen || words.length > tokens.length) continue;
    if (words.every((w, i) => tokens[i] === w)) {
      best = c;
      bestLen = words.length;
    }
  }
  return best;
}

/** A journal step's label as a sentence and its subject — the raw line when it names no catalogue command with a sentence. */
export function stepSentence(
  label: string,
  commands: readonly CommandInfo[],
  locale: string,
  names: MenuNamers = {},
): string {
  const tokens = (label.match(TOKEN) ?? []).map(unquote);
  const c = commandOf(tokens, commands);
  const readable = c?.readable as Record<string, string> | undefined;
  const sentence = readable?.[locale] || readable?.en;
  if (!c || !sentence) return label;
  const value = tokens[c.command.split(" ").length];
  if (!value) return sentence;
  const provider = c.args[0]?.provider;
  const subject =
    provider && LANES.has(provider) && names.lane
      ? names.lane(value)
      : provider && CLIPS.has(provider) && names.clip
        ? names.clip(value)
        : value;
  return `${sentence} · ${subject}`;
}
