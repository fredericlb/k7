// prefs.ts — the account's médiathèque preferences, read once and PATCHED. The route replaces
// wholesale, so this is the one place that holds the whole object; a caller that PUT its own
// field alone would clear everybody else's.

import type { EnginePrefs } from "@studio/engine-browser/registry";
import { engines } from "./api";

/** The front-end's structural copy of the backend's `prefsSchema`, that being a separate build. */
export interface Pl8Prefs extends EnginePrefs {
  /** Which engine auditions a module. The registry's own field. */
  engineId?: string;
}

/** The last known whole object, at module level because two hooks share a DOCUMENT, not a subtree. */
let known: Pl8Prefs = {};
let reading: Promise<Pl8Prefs> | null = null;

/** Read once per page, memoised on the PROMISE; a failed read gives `{}` and is not cached. */
export async function readPrefs(): Promise<Pl8Prefs> {
  if (reading) return reading;
  reading = engines()
    .prefs()
    .then((p) => {
      known = p ?? {};
      return known;
    })
    .catch(() => {
      reading = null;
      return {} as Pl8Prefs;
    });
  return reading;
}

/** Change some fields and keep the rest: read-then-write, so a fresh page clears nothing. */
export async function patchPrefs(change: Partial<Pl8Prefs>): Promise<void> {
  const current = await readPrefs();
  known = { ...current, ...change };
  await engines()
    .savePrefs(known)
    .catch(() => {});
}
