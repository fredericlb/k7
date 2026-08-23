// commitOutcome.ts — reading `project commit`'s answer as an OUTCOME. Pure and kept apart: this is
// exactly the logic that announced a success for a commit that never happened, and a module
// importing nothing is a module a test can load. See ./machine.ts.

/** What the command answered, read as an OUTCOME — POSITIVE proof of success is required, or a wrong verb reads as a success. */
export function commitOutcome(out: string[]): string | null {
  if (out.some((l) => l.startsWith("committed ")))
    // A failed push is not a failed commit: it is recovered by pushing later rather than by starting over, so it is said separately.
    return out.find((l) => l.startsWith("push failed")) ?? null;
  if (out.some((l) => l.startsWith("nothing to commit")))
    return "rien à committer — le dossier est-il ignoré par git ?";
  // Everything else is a failure, unrecognised output included: the raw output beats silence, and it will name the next drift.
  return out.join(" · ").trim() || "la commande n'a rien répondu";
}
