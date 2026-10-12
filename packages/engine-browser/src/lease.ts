// lease.ts — hold the claim on an engine, for one project, for as long as a tab drives it. No
// React and no fetching: the caller passes its own two backend calls, because each service
// reaches its own backend under its own path. See docs/lease.md for why a single select is not
// enough, and @studio/engine-registry/docs/claim.md for what the project on it changed.

import { ENGINE_ASSIGN_RENEW_MS } from "@studio/web-protocol";
import {
  type ClaimGrant,
  ClaimLost,
  type ClaimLostReason,
} from "./registry.ts";

/** The two calls a service's api client already has. `release` is fire-and-forget by nature. */
export interface EngineLeaseApi {
  select(
    id: string,
    token: string,
    latencyMs: number,
    project: string | null,
    secret?: string,
  ): Promise<ClaimGrant>;
  release(id: string, secret: string): void;
}

/** The losses that are SOMEBODY ELSE's doing. `lapsed` is not one: the loop re-opens on it. */
export type ClaimTakenReason = Exclude<ClaimLostReason, "lapsed">;

/** Why the claim is gone for good, in the two shapes a surface has to word differently. */
export interface ClaimTaken {
  reason: ClaimTakenReason;
  /** For `engine`: the project that took the machine, when the server named it. */
  tookFor: string | null;
}

export interface HoldOptions {
  /** The launch address this tab opened — `<repo>/<projet>`. Null for a surface with no project. */
  project: string | null;
  /** Somebody took the claim; called at most once, and the caller must STOP DRIVING rather than retry — see docs/lease.md. */
  onLost?: (heldBy: string, why: ClaimTaken) => void;
}

/** Take the claim and keep it, returning the goodbye: "assigned" is a LEASE and a single select would lapse — see docs/lease.md. */
export function holdEngine(
  api: EngineLeaseApi,
  id: string,
  token: string,
  /** What this link measured, ms — reported so the server can constrain on it later. */
  latencyMs: number,
  opts: HoldOptions = { project: null },
): () => void {
  let secret: string | undefined;
  let done = false;

  const renew = () => {
    if (done) return;
    api.select(id, token, latencyMs, opts.project, secret).then(
      (grant) => {
        secret = grant.secret;
      },
      (e) => {
        // A miss is fine — the TTL grants grace — but losing the CLAIM is not a miss, it is the answer.
        if (!(e instanceof ClaimLost)) return;
        if (e.reason === "lapsed") {
          // Nobody took anything, so forget the dead secret and let the NEXT tick open again — see docs/lease.md.
          secret = undefined;
          return;
        }
        done = true;
        clearInterval(timer);
        opts.onLost?.(e.heldBy, { reason: e.reason, tookFor: e.tookFor });
      },
    );
  };

  renew(); // immediately — a StrictMode remount, whose cleanup released, has to re-claim
  const timer = setInterval(renew, ENGINE_ASSIGN_RENEW_MS);
  const bye = () => {
    if (secret) api.release(id, secret);
  };
  window.addEventListener("pagehide", bye);
  // A tab coming back renews at once: while hidden, its timer may have been held to one tick a minute.
  const back = () => {
    if (document.visibilityState === "visible") renew();
  };
  const doc = typeof document === "undefined" ? null : document;
  doc?.addEventListener("visibilitychange", back);
  return () => {
    done = true;
    clearInterval(timer);
    window.removeEventListener("pagehide", bye);
    doc?.removeEventListener("visibilitychange", back);
    bye(); // unmounting without pagehide == switching away, so release now
  };
}
