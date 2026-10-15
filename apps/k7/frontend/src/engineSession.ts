// engineSession.ts — which engine session this tab drives, and where the bench should play. The
// bench has a session of its own so it runs BESIDE the song; see apps/k7/backend/docs/media/banc.md.
//
// The one thing a reader would get wrong: the file service derives the same name from the
// WORKSPACE (`sessionOf`), so both halves must agree that the bench is `@banc` and `Banc`.

import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { parseLaunch } from "@studio/project-shell/launch";
import type { PublicEngine } from "@studio/web-protocol";
import { claimSlot, isBench } from "@studio/web-protocol/projects";

/** The session this tab's address plays in, for `who` — the bench's own, or the song's. */
export function engineSession(
  who: string,
  pathname: string,
  base: string,
): string {
  const at = parseLaunch(pathname, "k7", base);
  return sessionFor(at && isBench(at.repo) ? SESSIONS.bench : SESSIONS.k7, who);
}

/** The engine this account already plays a project on, which a bench must share: the account's files drive one engine at a time. */
export function accountEngine<
  R extends { engine: PublicEngine; wsUrl: string | null },
>(ranked: R[], who: string): R | undefined {
  return ranked.find(
    (r) =>
      r.wsUrl &&
      (r.engine.heldProjects ?? []).some(
        (h) => h.holder === who && claimSlot(h.project) === "project",
      ),
  );
}
