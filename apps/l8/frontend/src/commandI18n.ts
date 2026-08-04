// commandI18n.ts — command names for the web UI, English ONLY: commands are the CLI's,
// and the CLI is English, so the bar shows, matches and dispatches by canonical name and
// nothing else. These functions deliberately collapse to that name, so a command is
// spelled one way everywhere; arguments are never translated (they're identifiers).

import { m } from "./paraglide/messages.js";

const PREFIX = "cmd.";

type MessageFn = (
  inputs?: Record<string, unknown>,
  options?: { locale?: string },
) => string;
const messages = m as unknown as Record<string, MessageFn>;

/** Every canonical command the catalogue knows, read off the "cmd.*" keys. */
const CANONICALS: readonly string[] = Object.keys(messages)
  .filter((k) => k.startsWith(PREFIX))
  .map((k) => k.slice(PREFIX.length));

/** The display name of a command — its canonical (English) name. */
export function localizeCommand(canonical: string): string {
  return canonical;
}

/**
 * The command's name(s) for the bar and completion — English only, so a single entry.
 * Kept as an array because callers match a typed partial against the list.
 */
export function commandTranslations(canonical: string): string[] {
  return [canonical];
}

/** The single-line display for a command — its canonical (English) name. */
export function commandLabel(canonical: string): string {
  return commandTranslations(canonical).join("/");
}

// Longest name first, like the dispatcher: insurance against a future `module list` shadowing `module list plugins`.
function byLengthDesc(a: { from: string }, b: { from: string }): number {
  return b.from.length - a.from.length;
}

function mapPrefix(
  line: string,
  table: { from: string; to: string }[],
): string {
  const s = line.trim();
  for (const { from, to } of table.sort(byLengthDesc)) {
    // Whole-word prefix: "recharger" must not match "rec", so the name ends the line or is followed by a space.
    if (s === from || s.startsWith(`${from} `))
      return to + s.slice(from.length);
  }
  return s;
}

/**
 * A typed line → the canonical line the dispatchers (runLocalCommand, api.command,
 * api.complete) understand. Command names are English, so this is effectively identity
 * on the command name; arguments after it pass through untouched.
 */
export function canonicalizeCommand(line: string): string {
  const table: { from: string; to: string }[] = [];
  for (const c of CANONICALS)
    for (const name of commandTranslations(c))
      table.push({ from: name, to: c });
  return mapPrefix(line, table);
}

/** A canonical line (e.g. a backend completion) → its display form (English). */
export function localizeCommandLine(line: string): string {
  return mapPrefix(
    line,
    CANONICALS.map((c) => ({ from: c, to: localizeCommand(c) })),
  );
}

/** Every command name, for command-name completion — so a partial finds its command. */
export function localizedCommandNames(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of CANONICALS)
    for (const name of commandTranslations(c))
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
  return out;
}
