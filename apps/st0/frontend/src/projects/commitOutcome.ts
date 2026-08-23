// commitOutcome.ts — reading `project commit`'s answer as an OUTCOME. Pure and kept apart: this is
// exactly the logic that announced a success for a commit that never happened, and a module
// importing nothing is a module a test can load. See ./machine.ts.

/**
 * What the command answered, read as an OUTCOME: `null` if the commit went through, otherwise the
 * complaint.
 *
 * POSITIVE proof of success is required, and that is the heart of this function's bug: its first
 * version looked for known failure words and returned `null` for everything else. The verb was
 * wrong (`commit` instead of `project commit`), the command answered "unknown command", and the
 * screen announced a success. A created project was neither committed nor pushed, without a word.
 *
 * The lines come from `project.commit` in packages/commands/src/commands.ts.
 */
export function commitOutcome(out: string[]): string | null {
  if (out.some((l) => l.startsWith("committed ")))
    // A failed push is not a failed commit: say it separately, because it is recovered by pushing
    // later rather than by starting over.
    return out.find((l) => l.startsWith("push failed")) ?? null;
  if (out.some((l) => l.startsWith("nothing to commit")))
    return "rien à committer — le dossier est-il ignoré par git ?";
  // Everything else is a failure, unrecognised output included: the raw output beats silence, and
  // it is what will name the next drift.
  return out.join(" · ").trim() || "la commande n'a rien répondu";
}
