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
  /**
   * Somebody took the claim. `why` says which of the two, because "your project is open
   * elsewhere" and "another project took this engine" are opposite advice on screen.
   *
   * Called at most once. The caller is expected to STOP DRIVING and say so — there is no retry,
   * because retrying is how a takeover turns into two tabs trading a project every five seconds.
   * A claim that merely LAPSED never reaches here: see the re-open below.
   */
  onLost?: (heldBy: string, why: ClaimTaken) => void;
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
 *
 * A LAPSE is not a displacement and is not reported: the loop drops the dead secret and opens
 * again on the next tick. See docs/lease.md.
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
        // socket. Losing the CLAIM is not a miss — it is the answer.
        if (!(e instanceof ClaimLost)) return;
        if (e.reason === "lapsed") {
          // Nobody took anything. The server says `lapsed` precisely when nothing holds this
          // project AND nothing else holds this engine, so opening again takes it from no one —
          // which is what the tab waking from a sleep or a network gap wants, rather than a
          // dead end telling someone to go and click their own project a second time.
          // Forget the dead secret; the next tick's select is an OPEN and is always granted.
          // Not right now: a deregistered engine answers `lapsed` too, and re-opening on the
          // spot would spin against it as fast as the network allows.
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
  return () => {
    done = true;
    clearInterval(timer);
    window.removeEventListener("pagehide", bye);
    bye(); // unmounting without pagehide == switching away, so release now
  };
}
