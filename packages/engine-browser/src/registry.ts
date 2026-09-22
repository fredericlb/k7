// registry.ts — a browser's client for its OWN service's engine registry: which engines exist,
// taking and releasing the lease on one, and the account's remembered choice. Every hosted
// service mounts the same five routes (@studio/engine-registry), so they are spelled once here
// rather than per app: a copy per app drifts, and it drifts in the return types first.

/** What one account has this service remember; `engineId` is the only field EVERY service keeps, and a host widens `P` below. */
export interface EnginePrefs {
  engineId?: string;
}

// `P` is a service's OWN preference shape, a parameter rather than a fixed one because the schema belongs to the host (packages/user-prefs/docs/store.md).

/** What `select` answers: the secret to renew with, and whom this claim displaced if anyone. */
export interface ClaimGrant {
  ok: true;
  secret: string;
  tookOver?: { holder: string; engineId: string };
}

/** Why a claim stopped being ours: `project` (opened elsewhere), `engine` (`tookFor`), `lapsed` (aged out). */
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
  /** Claim an engine for a project, or renew a claim held: no `secret` is an OPEN and always wins, a `secret` a renewal that can be refused. */
  select(
    id: string,
    token: string,
    latencyMs: number,
    project: string | null,
    secret?: string,
  ): Promise<ClaimGrant>;
  /** The CLAIM's secret, not the engine token: a goodbye may only drop the claim it actually holds. */
  release(id: string, secret: string): boolean;
  prefs(): Promise<P>;
  /** WHOLESALE — the router REPLACES, so a caller holding one field wipes the rest; reach for `patchPrefs` instead. */
  savePrefs(p: P): Promise<{ ok: true }>;
  /** One field, the others left alone — read, merge, write, here rather than on a server that has nothing to merge with. */
  patchPrefs(p: Partial<P>): Promise<{ ok: true }>;
}

/** Read a JSON body, or throw with `what` in the message; passed in because each app already has one wired to its own reporting. */
export type ReadJson = <T>(res: Response, what: string) => Promise<T>;

/** The five routes against one service's `base` — the SERVICE the browser loaded, never another, each holding its own registry. */
export function registryClient<E, P extends EnginePrefs = EnginePrefs>(
  base: string,
  json: ReadJson,
): RegistryClient<E, P> {
  return {
    list: async () =>
      json<E[]>(
        await fetch(`${base}/api/engines`, { credentials: "include" }),
        "engines",
      ),

    /** Take or RENEW the claim, token-checked server-side; the holder re-POSTs every ENGINE_ASSIGN_RENEW_MS, since "in use" expires. */
    async select(id, token, latencyMs, project, secret) {
      const res = await fetch(`${base}/api/engine/select`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, token, latencyMs, project, secret }),
      });
      // 409 is not a fault: the request was fine and the project moved, so it gets its own type rather than reading as a network error.
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          heldBy?: string;
          lost?: ClaimLostReason;
          tookFor?: string | null;
        };
        // Defaulting to `project` is what an older backend's bare 409 means.
        throw new ClaimLost(
          body.heldBy ?? "",
          body.lost ?? "project",
          body.tookFor ?? null,
        );
      }
      return json<ClaimGrant>(res, "select");
    },

    /** The claim's goodbye, as a BEACON so it survives the tab closing; best-effort by nature, which is why the TTL sits behind it. */
    release: (id, secret) =>
      navigator.sendBeacon(
        `${base}/api/engine/release`,
        new Blob([JSON.stringify({ id, secret })], {
          type: "application/json",
        }),
      ),

    prefs: async () =>
      json<P>(
        await fetch(`${base}/api/preferences`, { credentials: "include" }),
        "preferences",
      ),

    savePrefs: async (p) =>
      json<{ ok: true }>(
        await fetch(`${base}/api/preferences`, {
          method: "PUT",
          credentials: "include",
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
