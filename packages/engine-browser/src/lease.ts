// lease.ts — hold the claim on an engine, for one project, for as long as a tab drives it. No
// React and no fetching: the caller passes its own two backend calls, because each service
// reaches its own backend under its own path. See docs/lease.md for why a single select is not
// enough, and @studio/engine-registry/docs/claim.md for what the project on it changed.

import { ENGINE_ASSIGN_RENEW_MS } from "@studio/web-protocol";
import { type ClaimGrant, ClaimLost } from "./registry.ts";

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

export interface HoldOptions {
  /** The launch address this tab opened — `<repo>/<projet>`. Null for a surface with no project. */
  project: string | null;
  /**
   * We no longer hold the claim. `why` says which of the three happened — the surface has to
   * word them differently, because only one of them is "your project is open elsewhere".
   *
   * Called at most once. The caller is expected to STOP DRIVING and say so — there is no retry,
   * because retrying is how a takeover turns into two tabs trading a project every five seconds.
   */
  onLost?: (heldBy: string, why: ClaimLost) => void;
}

/**
 * Take the claim and keep it. Returns the goodbye, to call on unmount.
 *
 * "Assigned" is a LEASE, not a flag — the registry stores a timestamp precisely because the
 * holder is a browser tab and can only say goodbye best-effort. A single `select` therefore
 * lapses after ENGINE_ASSIGN_TTL_MS, and the engine reads FREE in everyone's picker while it
 * is still being driven. Both the médiathèque and m9 shipped that bug before this was shared.
 *
 * The claim carries a PROJECT now, and with it the rule that one project lives on one engine.
 * The first call has no secret, which the registry reads as an open and always grants — taking
 * the project from whoever had it. Every call after it carries the secret it was given, so the
 * tab that was displaced is refused rather than granted, and learns through `onLost`.
 */
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
        // A miss is fine: the TTL grants grace, and a genuinely gone engine shows up on the
        // socket. Losing the CLAIM is not a miss — it is the answer, and it is final.
        if (!(e instanceof ClaimLost)) return;
        done = true;
        clearInterval(timer);
        opts.onLost?.(e.heldBy, e);
      },
    );
  };

  renew(); // immediately — a StrictMode remount, whose cleanup released, has to re-claim
  const timer = setInterval(renew, ENGINE_ASSIGN_RENEW_MS);
  const bye = () => {
    if (secret) api.release(id, secret);
  };
  window.addEventListener("pagehide", bye);
  return () => {
    done = true;
    clearInterval(timer);
    window.removeEventListener("pagehide", bye);
    bye(); // unmounting without pagehide == switching away, so release now
  };
}
