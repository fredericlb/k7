// commitOutcome.ts — reading `project commit`'s answer as an OUTCOME. Pure and kept apart: this is
// exactly the logic that announced a success for a commit that never happened, and a module
// importing nothing is a module a test can load. See ./workspaceOps.ts.

import { m } from "../paraglide/messages.js";

/**
 * What the command answered, read as an OUTCOME — POSITIVE proof of success is required, or a
 * wrong verb reads as a success. `noRemote` is for a workspace that has never been published:
 * there the push CANNOT have worked, and reporting it would make the ordinary state look broken.
 */
export function commitOutcome(
  out: string[],
  opts: { noRemote?: boolean } = {},
): string | null {
  if (out.some((l) => l.startsWith("committed ")))
    // A failed push is not a failed commit: it is recovered by pushing later rather than by starting over, so it is said separately.
    return opts.noRemote
      ? null
      : (out.find((l) => l.startsWith("push failed")) ?? null);
  if (out.some((l) => l.startsWith("nothing to commit")))
    return m["commit.nothing"]();
  // Everything else is a failure, unrecognised output included: the raw output beats silence, and it will name the next drift.
  return out.join(" · ").trim() || m["commit.silent"]();
}
