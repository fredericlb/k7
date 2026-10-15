// studios.ts — which studio the app views open, and where each of its apps answers. The studios are
// the ones the supervisor is connected to (the engine tray's list); each app's address comes from
// serviceUrl, the one mapping UserMenu and the apps themselves use (docs/addresses.md).

import {
  isLoopbackHost,
  localServiceUrl,
  serviceUrl,
  studioFamily,
} from "@studio/web-protocol/services";
import { APP_IDS, type AppId, type StudioInstance } from "./native";

/** A family as the origin its k7 answers on: a loopback one is this phone's own backend, at its port. */
const k7Origin = (family: string): string =>
  isLoopbackHost(new URL(family).hostname) ? localServiceUrl("k7") : family;

/** k7's origin for each connected studio, once each: the phone's own first, then the supervisor's order. */
export function studioOrigins(
  instances: StudioInstance[] | undefined,
): string[] {
  const seen = new Set<string>();
  for (const { url } of instances ?? []) {
    const family = studioFamily(url);
    if (family) seen.add(k7Origin(family));
  }
  const local = localServiceUrl("k7");
  return [...seen].sort((a, b) => Number(b === local) - Number(a === local));
}

/** Every tab's address on the studio at `origin`. */
export function appUrls(origin: string): Record<AppId, string> {
  return Object.fromEntries(
    APP_IDS.map((id) => [id, serviceUrl(origin, id)]),
  ) as Record<AppId, string>;
}

const CHOSEN = "k7-android.studio";

/** The studio the user last picked, if it is still connected; else the first one. */
export function pickStudio(origins: string[]): string | null {
  let kept: string | null = null;
  try {
    kept = localStorage.getItem(CHOSEN);
  } catch {
    // No storage: the first studio will do.
  }
  if (kept && origins.includes(kept)) return kept;
  return origins[0] ?? null;
}

export function rememberStudio(origin: string) {
  try {
    localStorage.setItem(CHOSEN, origin);
  } catch {
    // Only a convenience.
  }
}
