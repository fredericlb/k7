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
/** What `select` answers: the secret to renew with, and whom this claim displaced if anyone. */
export interface ClaimGrant {
  ok: true;
  secret: string;
  tookOver?: { holder: string; engineId: string };
}

/**
 * Why a claim stopped being ours. Three answers, because a surface that can only say one of
 * them says the wrong one most of the time.
 *
 * `project` — the same project was opened, here or elsewhere.
 * `engine`  — a DIFFERENT project took this engine; `tookFor` names it.
 * `lapsed`  — nobody took anything; the claim aged out.
 */
export type ClaimLostReason = "project" | "engine" | "lapsed";

/** A `select` refused because the claim moved on — thrown by the client, carrying why. */
export class ClaimLost extends Error {
  constructor(
    readonly heldBy: string,
    readonly reason: ClaimLostReason = "project",
    /** For `engine`: the project that took the machine, when the server named it. */
    readonly tookFor: string | null = null,
  ) {
    super(
      reason === "engine"
        ? `this engine is now driving ${tookFor ?? "another project"}`
        : reason === "lapsed"
          ? "this claim lapsed"
          : heldBy
            ? `this project is now open by ${heldBy}`
            : "this project was taken over",
    );
    this.name = "ClaimLost";
  }
}

export interface RegistryClient<E, P extends EnginePrefs = EnginePrefs> {
  list(): Promise<E[]>;
  /**
   * Claim an engine for a project, or renew a claim already held.
   *
   * `secret` absent = an OPEN, which always wins. `secret` present = a renewal, which is refused
   * with `ClaimLost` if somebody has taken the project since. Those must stay distinguishable, or
   * a displaced tab renews its way back in and the two fight for ever.
   */
  select(
    id: string,
    token: string,
    latencyMs: number,
    project: string | null,
    secret?: string,
  ): Promise<ClaimGrant>;
  /** The CLAIM's secret, not the engine token: a goodbye may only drop the claim it holds.
   *  See @studio/engine-registry's router. */
  release(id: string, secret: string): boolean;
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

    /** Take or RENEW the claim, verifying the token server-side. The holder re-POSTs it every
     *  ENGINE_ASSIGN_RENEW_MS, because "in use" expires on its own. */
    async select(id, token, latencyMs, project, secret) {
      const res = await fetch(`${base}/api/engine/select`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, latencyMs, project, secret }),
      });
      // 409 is not a fault and must not read as one: the request was fine, the project moved.
      // Its own type, so a caller can tell "let go and say so" from "the network is down".
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          heldBy?: string;
          lost?: ClaimLostReason;
          tookFor?: string | null;
        };
        // Defaulting to `project` keeps an older backend's bare 409 reading as it always did.
        throw new ClaimLost(
          body.heldBy ?? "",
          body.lost ?? "project",
          body.tookFor ?? null,
        );
      }
      return json<ClaimGrant>(res, "select");
    },

    /** The claim's goodbye, as a BEACON so it survives the tab closing — a fetch there is
     *  cancelled with the page. Best-effort by nature, which is why the TTL exists behind it. */
    release: (id, secret) =>
      navigator.sendBeacon(
        `${base}/api/engine/release`,
        new Blob([JSON.stringify({ id, secret })], {
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
