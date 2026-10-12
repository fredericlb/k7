// access.ts — one object per app for everything a browser does to reach an engine: the
// registry's five routes, the probe, the choice and the lease. The pieces below it already
// existed; what this adds is that `base` is given ONCE. See docs/access.md.

import {
  ENGINE_CONNECT_DEADLINE_MS,
  FILE_HUB_HELLO,
  type FileHubHello,
} from "@studio/web-protocol";
import { chooseEngine } from "./choose.ts";
import { type HoldOptions, holdEngine } from "./lease.ts";
import { type ProbeTarget, probeEngines, type RankedEngine } from "./probe.ts";
import {
  type EnginePrefs,
  type ReadJson,
  type RegistryClient,
  registryClient,
} from "./registry.ts";

/** What one look at the registry produced: the measured list, and what to do with it. */
export interface EngineLookup<E extends ProbeTarget> {
  /** Every engine this service knows, MEASURED — the unreachable sink to the bottom. */
  ranked: RankedEngine<E>[];
  /** The id the account remembers, whether or not it answered. */
  rememberedId: string | undefined;
  /** The one to drive, or null when there is a question to ask (or nothing to ask about). */
  chosen: RankedEngine<E> | null;
  /** Several answered and none was remembered — the only case worth a picker. */
  ambiguous: boolean;
}

export interface EngineAccess<
  E extends ProbeTarget,
  P extends EnginePrefs = EnginePrefs,
> extends RegistryClient<E, P> {
  /** Measure every engine in the list, through this service's relay when the direct link is refused; curried on `base`. */
  probe(engines: E[]): Promise<RankedEngine<E>[]>;
  /** List, read the preference, measure, apply the policy — and a silent registry reads as NO ENGINE. See docs/access.md. */
  find(preferId?: string): Promise<EngineLookup<E>>;
  /** Claim a measured engine for a project and keep it, returning the goodbye; `opts.project` is what makes "one engine per project" true. */
  hold(chosen: RankedEngine<E>, opts?: HoldOptions): () => void;
  /** Where to reach ONE engine, asked AGAIN rather than kept, since a relayed URL's ticket lives a minute — see docs/access.md. */
  wsUrlFor(id: string): Promise<string | null>;
  /** What to hand `new EngineClient(...)`: the address just measured, then a fresh one on every reconnect after it. */
  linkUrl(chosen: RankedEngine<E>): () => string | Promise<string | null>;
  /** The account's files on the server with no engine bound, or null when the server hosts none — see docs/access.md. */
  hostedFiles(): Promise<HostedFiles | null>;
  /** A new hub ticket, asked for now whatever the cache holds — what a 401 on the files means. Null when none can be had. */
  freshTicket(): Promise<string | null>;
}

/** Where the server's file service answers, and the ticket its gate takes. */
export interface HostedFiles {
  fileBase: string;
  fileToken: string;
  /** The hub found the caller in the origin's admin groups — the ticket says so too. */
  admin: boolean;
}

/** Where an app keeps its preferences, when that is not where the registry is — st0, whose registry is pl8's. */
export interface EngineAccessOptions {
  prefsBase?: string;
  /** Reach the SERVER's files when it hosts them, rather than the engine machine's — see docs/access.md. */
  hostedFiles?: boolean;
}

/** A ticket is good for twelve hours; asking again after six keeps a long session clear of the edge. */
const HELLO_FRESH_MS = 6 * 60 * 60_000;

/** Everything one app's browser needs, bound to the registry's origin (and the app's own, for its preferences) ONCE — see docs/access.md. */
export function engineAccess<
  E extends ProbeTarget,
  P extends EnginePrefs = EnginePrefs,
>(
  base: string,
  json: ReadJson,
  opts: EngineAccessOptions = {},
): EngineAccess<E, P> {
  const reg = registryClient<E, P>(base, json, opts.prefsBase ?? base);
  let hello: { at: number; p: Promise<FileHubHello | null> } | null = null;
  /** Whether the registry's server hosts the files, asked once and again when the ticket ages. */
  const hubHello = (): Promise<FileHubHello | null> => {
    if (!hello || Date.now() - hello.at > HELLO_FRESH_MS) {
      const asked = {
        at: Date.now(),
        p: fetch(`${base}${FILE_HUB_HELLO}`, {
          credentials: "include",
          signal: AbortSignal.timeout(ENGINE_CONNECT_DEADLINE_MS),
        })
          .then((r) => (r.ok ? (r.json() as Promise<FileHubHello>) : null))
          .catch(() => null),
      };
      hello = asked;
      // Only an answer is kept: a failure held for hours would leave every engine unpickable until a reload.
      void asked.p.then((h) => {
        if (!h && hello === asked) hello = null;
      });
    }
    return hello.p;
  };
  const probe = async (engines: E[]): Promise<RankedEngine<E>[]> => {
    const ranked = await probeEngines(engines, base);
    const hub = opts.hostedFiles ? await hubHello() : null;
    if (!hub) return ranked;
    // Every reachable engine plays the SAME files, the server's; which one drives them rides after the `~`.
    return ranked.map((r) =>
      r.wsUrl
        ? {
            ...r,
            fileBase: `${base}${hub.path}`,
            fileToken: `${hub.ticket}~${r.engine.id}`,
            filesHosted: true,
          }
        : r,
    );
  };

  return {
    ...reg,
    probe,
    async freshTicket() {
      hello = null;
      return (await hubHello())?.ticket ?? null;
    },
    async find(preferId) {
      // Both at once: a remembered id is only a hint that still has to be probed, so serialising them would cost a round trip per load.
      const [list, prefs] = await Promise.all([
        reg.list().catch(() => [] as E[]),
        reg.prefs().catch(() => ({}) as P),
      ]);
      const ranked = await probe(list);
      const rememberedId = preferId ?? prefs.engineId;
      const { engine, ambiguous } = chooseEngine(ranked, rememberedId);
      return { ranked, rememberedId, chosen: engine, ambiguous };
    },
    hold: (chosen, opts) =>
      holdEngine(
        reg,
        chosen.engine.id,
        chosen.token ?? "",
        chosen.latency?.totalMs ?? 0,
        opts ?? { project: null },
      ),
    linkUrl(chosen) {
      let measured: string | null = chosen.wsUrl;
      return () => {
        const first = measured;
        measured = null; // spent: from here on, ask for a live one
        return first ?? this.wsUrlFor(chosen.engine.id);
      };
    },
    async hostedFiles() {
      const hub = opts.hostedFiles ? await hubHello() : null;
      return hub
        ? {
            fileBase: `${base}${hub.path}`,
            fileToken: hub.ticket,
            admin: hub.admin === true,
          }
        : null;
    },
    async wsUrlFor(id) {
      // Through the registry rather than a cache: the ticket is minted by that call, so there is no fresh URL to be had without it.
      const list = await reg.list().catch(() => [] as E[]);
      const engine = list.find((e) => e.id === id);
      if (!engine) return null;
      const [ranked] = await probe([engine]);
      return ranked?.wsUrl ?? null;
    },
  };
}
