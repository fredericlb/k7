// registry.ts — a browser's client for its OWN service's engine registry: which engines exist,
// taking and releasing the lease on one, and the account's remembered choice. Every hosted
// service mounts the same five routes (@studio/engine-registry), so they are spelled once here
// rather than per app — st0's and m9's copies had already drifted in their return types.

/**
 * What one account has this service remember. `engineId` is the only field EVERY service keeps
 * — it is what the registry itself is for — and a host adds its own by widening `P` below.
 */
export interface EnginePrefs {
  engineId?: string;
}

/**
 * What a service answers on `/api/engines`. Structural, so no app has to import a shape.
 *
 * `P` is that service's preference shape. It is a parameter rather than a fixed
 * `{engineId?}` because the schema belongs to the HOST (`packages/user-prefs/docs/store.md`)
 * and a union of every service's fields would be a shape no service actually has: st0
 * remembers where playback happens, l8 does not. Defaulted, so an app that keeps nothing
 * else says nothing.
 */
export interface RegistryClient<E, P extends EnginePrefs = EnginePrefs> {
  list(): Promise<E[]>;
  select(id: string, token: string, latencyMs: number): Promise<{ ok: true }>;
  /** The engine's own token, same as `select`: dropping someone else's lease is not something
   *  a session alone should buy. See @studio/engine-registry's router. */
  release(id: string, token: string): boolean;
  prefs(): Promise<P>;
  /**
   * WHOLESALE — the router REPLACES, it does not merge.
   *
   * Reach for `patchPrefs` unless you genuinely mean to clear everything else: a caller
   * holding one field wipes the rest, which is how choosing a machine in z0's editor came to
   * erase the médiathèque's playback destination.
   */
  savePrefs(p: P): Promise<{ ok: true }>;
  /**
   * One field, the others left alone — read, merge, write.
   *
   * Not a PATCH route: the store replaces documents and there is nothing on the server that
   * merges. Doing it here means every service gets the safe verb, rather than st0 being the
   * only one that remembered to write the merge by hand.
   */
  patchPrefs(p: Partial<P>): Promise<{ ok: true }>;
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
export function registryClient<E, P extends EnginePrefs = EnginePrefs>(
  base: string,
  json: ReadJson,
): RegistryClient<E, P> {
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
    release: (id, token) =>
      navigator.sendBeacon(
        `${base}/api/engine/release`,
        new Blob([JSON.stringify({ id, token })], {
          type: "application/json",
        }),
      ),

    prefs: async () =>
      json<P>(await fetch(`${base}/api/preferences`), "preferences"),

    savePrefs: async (p) =>
      json<{ ok: true }>(
        await fetch(`${base}/api/preferences`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(p),
        }),
        "preferences",
      ),

    async patchPrefs(p) {
      // A missing document is an empty one, not a failure: the first save is what creates it.
      const current = await this.prefs().catch(() => ({}) as P);
      return this.savePrefs({ ...current, ...p });
    },
  };
}
