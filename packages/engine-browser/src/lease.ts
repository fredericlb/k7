// lease.ts — hold an engine marked "in use" for as long as a tab drives it. No React and no
// fetching: the caller passes its own two backend calls, because each service reaches its own
// backend under its own path. See docs/lease.md for why a single select is not enough.

import { ENGINE_ASSIGN_RENEW_MS } from "@studio/web-protocol";

/** The two calls a service's api client already has. `release` is fire-and-forget by nature. */
export interface EngineLeaseApi {
  select(id: string, token: string, latencyMs: number): Promise<unknown>;
  release(id: string): void;
}

/**
 * Take the lease and keep it. Returns the goodbye, to call on unmount.
 *
 * "Assigned" is a LEASE, not a flag — the registry stores a timestamp precisely because the
 * holder is a browser tab and can only say goodbye best-effort. A single `select` therefore
 * lapses after ENGINE_ASSIGN_TTL_MS, and the engine reads FREE in everyone's picker while it
 * is still being driven. Both the médiathèque and m9 shipped that bug before this was shared.
 */
export function holdEngine(
  api: EngineLeaseApi,
  id: string,
  token: string,
  /** What this link measured, ms — reported so the server can constrain on it later. */
  latencyMs: number,
): () => void {
  // A miss is fine: the TTL grants grace, and a genuinely gone engine shows up on the socket.
  const renew = () => {
    api.select(id, token, latencyMs).catch(() => {});
  };
  renew(); // immediately — a StrictMode remount, whose cleanup released, has to re-claim
  const timer = setInterval(renew, ENGINE_ASSIGN_RENEW_MS);
  const bye = () => api.release(id);
  window.addEventListener("pagehide", bye);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", bye);
    bye(); // unmounting without pagehide == switching away, so release now
  };
}
