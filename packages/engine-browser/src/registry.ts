// registry.ts — a browser's client for its OWN service's engine registry: which engines exist,
// taking and releasing the lease on one, and the account's remembered choice. Every hosted
// service mounts the same five routes (@studio/engine-registry), so they are spelled once here
// rather than per app — st0's and m9's copies had already drifted in their return types.

/** What a service answers on `/api/engines`. Structural, so no app has to import a shape. */
export interface RegistryClient<E> {
  list(): Promise<E[]>;
  select(id: string, token: string, latencyMs: number): Promise<{ ok: true }>;
  release(id: string): boolean;
  prefs(): Promise<{ engineId?: string }>;
  savePrefs(p: { engineId?: string }): Promise<{ ok: true }>;
}

/** Read a JSON body, or throw with `what` in the message. Passed in because each app already
 *  has one, wired to its own error reporting — this module does not impose a second. */
export type ReadJson = <T>(res: Response, what: string) => Promise<T>;

/**
 * The five routes, against one service's `base`.
 *
 * `base` is the app's own origin prefix ("" for st0, "/m9" for the decks) — this talks to the
 * SERVICE the browser loaded, never to another one, because each holds its own registry (see
 * @studio/engine-registry's docs/shared.md).
 */
export function registryClient<E>(
  base: string,
  json: ReadJson,
): RegistryClient<E> {
  return {
    list: async () => json<E[]>(await fetch(`${base}/api/engines`), "engines"),

    /** Take or RENEW the lease, verifying the token server-side. Idempotent by design — the
     *  holder re-POSTs it every ENGINE_ASSIGN_RENEW_MS, because "in use" expires on its own. */
    select: async (id, token, latencyMs) =>
      json<{ ok: true }>(
        await fetch(`${base}/api/engine/select`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, token, latencyMs }),
        }),
        "select",
      ),

    /** The lease's goodbye, as a BEACON so it survives the tab closing — a fetch there is
     *  cancelled with the page. Best-effort by nature, which is why the TTL exists behind it. */
    release: (id) =>
      navigator.sendBeacon(
        `${base}/api/engine/release`,
        new Blob([JSON.stringify({ id })], { type: "application/json" }),
      ),

    prefs: async () =>
      json<{ engineId?: string }>(
        await fetch(`${base}/api/preferences`),
        "preferences",
      ),

    savePrefs: async (p) =>
      json<{ ok: true }>(
        await fetch(`${base}/api/preferences`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(p),
        }),
        "preferences",
      ),
  };
}
