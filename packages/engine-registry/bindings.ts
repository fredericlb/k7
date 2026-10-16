// bindings.ts — which TUNNEL SECRET each engine id belongs to: the first secret a heartbeat
// carries for an id binds it (trust on first use), and from then on only that secret may list
// or tunnel under the id. Kept on disk as id → sha256(secret), so the binding outlives the 15 s
// expiry and a restart. The secret is not the engine token: the browser never sees it — docs/token.md.

import { createHash, timingSafeEqual } from "node:crypto";
import { loadJson, saveJson } from "./stateFile.ts";

/** The file's name under a host's state dir. */
export const BINDINGS_FILE = "engine-bindings.json";
/** Past this many ids the least recently seen binding goes, so an open heartbeat cannot grow the file for ever. */
const MAX_BINDINGS = 10_000;
/** A bound id seen again rewrites its `at` at most this often, so a heartbeat every 5 s is not a write every 5 s. */
const REFRESH_MS = 24 * 60 * 60_000;

/** `bound`: the id's own secret; `fresh`: an unbound id offering one; `legacy`: unbound and none offered; `refused`: bound to another. */
type BindingVerdict = "bound" | "fresh" | "legacy" | "refused";

export interface SecretBindings {
  /** What `secret` is worth for `id`, changing nothing. */
  check(id: string, secret: string | undefined): BindingVerdict;
  /** Bind `id` to `secret` when it is unbound, or note it seen when it is bound to it; a caller checks first. */
  bind(id: string, secret: string): void;
}

interface Binding {
  /** sha256 of the secret, hex. */
  h: string;
  /** Epoch ms it was last bound or refreshed. */
  at: number;
}

const digest = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

const sameDigest = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The bindings at `file`, or in memory alone when no file is given (the tests, a host with no state dir). */
export function createBindings(
  file?: string,
  log: (line: string) => void = (l) => console.warn(`[registry] ${l}`),
  now: () => number = Date.now,
): SecretBindings {
  const map = new Map<string, Binding>(file ? load(file, log) : []);

  const save = (): void => {
    if (!file) return;
    const engines = Object.fromEntries(map);
    saveJson(file, { version: 1, engines }, "engine bindings", log);
  };

  return {
    check(id, secret) {
      const b = map.get(id);
      if (!b) return secret ? "fresh" : "legacy";
      return secret && sameDigest(digest(secret), b.h) ? "bound" : "refused";
    },
    bind(id, secret) {
      const b = map.get(id);
      const t = now();
      if (b) {
        if (t - b.at < REFRESH_MS) return;
        b.at = t;
        return save();
      }
      map.set(id, { h: digest(secret), at: t });
      if (map.size > MAX_BINDINGS) {
        const oldest = [...map].sort((x, y) => x[1].at - y[1].at)[0];
        if (oldest) map.delete(oldest[0]);
      }
      log(`engine ${id} bound to its tunnel secret`);
      save();
    },
  };
}

/** The bindings on disk; an unreadable file is set aside rather than overwritten, and said. */
function load(file: string, log: (line: string) => void): [string, Binding][] {
  const raw = loadJson(file, "engine bindings", log) as
    | { engines?: Record<string, unknown> }
    | undefined;
  const out: [string, Binding][] = [];
  for (const [id, v] of Object.entries(raw?.engines ?? {})) {
    const b = v as Partial<Binding>;
    if (typeof b?.h === "string" && typeof b.at === "number")
      out.push([id, { h: b.h, at: b.at }]);
  }
  return out;
}
