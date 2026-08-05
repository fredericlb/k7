// prefs.ts — the account's médiathèque preferences, read once and PATCHED. The route replaces
// wholesale, so this is the one place that holds the whole object; a caller that PUT its own
// field alone would clear everybody else's. See docs/playbackTarget.md.

import type { EnginePrefs } from "@studio/engine-browser/registry";
import { engines } from "./api";

/**
 * What this service remembers about a person. It is the front-end's copy of the backend's
 * `prefsSchema` — kept structural rather than imported, because the backend is a separate
 * build and this is a browser bundle.
 */
export interface St0Prefs extends EnginePrefs {
  /** Which engine auditions a module. The registry's own field. */
  engineId?: string;
  /** Where playback happens.
   *
   *  Typed `string` and not `PlaybackTarget`, which is the honest shape: the backend stores
   *  whatever string it is given (see its `prefsSchema`), so what comes back can be a
   *  destination this build has never heard of — written by a newer one, in another tab.
   *  `asPlaybackTarget` is what narrows it, at the one place that reads it. */
  playbackTarget?: string;
}

/**
 * The last known whole object, and the read that produced it.
 *
 * Module-level rather than a React context because it is not a rendering concern: two
 * independent hooks — the engine pick and the playback destination — write to one document,
 * and what they need to share is the DOCUMENT, not a subtree of the tree. A provider would
 * put the merge under whichever component happened to sit above both, which is an accident
 * of layout, and this file would still have to exist for the non-React caller.
 */
let known: St0Prefs = {};
let reading: Promise<St0Prefs> | null = null;

/**
 * Read them, once per page.
 *
 * Memoised on the PROMISE so two hooks mounting in the same tick make one request rather
 * than two. A failed read resolves to `{}` — the ordinary first-login state — and is not
 * cached, so the next caller looks again: a volume that was briefly unreachable must not
 * leave the tab believing this person has no preferences until it is reloaded.
 */
export async function readPrefs(): Promise<St0Prefs> {
  if (reading) return reading;
  reading = engines
    .prefs()
    .then((p) => {
      known = p ?? {};
      return known;
    })
    .catch(() => {
      reading = null;
      return {} as St0Prefs;
    });
  return reading;
}

/**
 * Change some fields and keep the rest.
 *
 * Read-then-write, and the read is the memoised one: the whole point is that the object PUT
 * back carries the fields this caller does not know about. Skipping the read — merging into
 * `known` alone — would clear every field on the very first write of a fresh page, which is
 * exactly the bug this file exists to prevent.
 *
 * The failure is swallowed, as `@studio/user-prefs` intends: what is lost is that the choice
 * outlives the session, and taking the choice away as well is strictly worse from where the
 * person is standing. `known` is updated either way, so the rest of the tab agrees with what
 * they just clicked.
 */
export async function patchPrefs(change: Partial<St0Prefs>): Promise<void> {
  const current = await readPrefs();
  known = { ...current, ...change };
  await engines.savePrefs(known).catch(() => {});
}

/** What has been read so far, for a caller that cannot wait — an empty object before the
 *  first read comes back, never a lie about a field it does hold. */
export function knownPrefs(): St0Prefs {
  return known;
}
