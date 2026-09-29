// studios.ts — which studio the app views open, and where each of its apps answers. The studios are
// the ones the supervisor is connected to (the engine tray's list); each app's address comes from
// serviceUrl, the one mapping AppSwitch and the apps themselves use (docs/addresses.md).

import { serviceUrl, studioFamily } from "@studio/web-protocol/services";
import { APP_IDS, type AppId, type StudioInstance } from "./native";

/** st0's origin for each connected studio, once each, in the supervisor's order. */
export function studioOrigins(
  instances: StudioInstance[] | undefined,
): string[] {
  const seen = new Set<string>();
  for (const { url } of instances ?? []) {
    const origin = studioFamily(url);
    if (origin) seen.add(origin);
  }
  return [...seen];
}

/** Every tab's address on the studio at `origin`. */
export function appUrls(origin: string): Record<AppId, string> {
  return Object.fromEntries(
    APP_IDS.map((id) => [id, serviceUrl(origin, id)]),
  ) as Record<AppId, string>;
}

const CHOSEN = "st0-android.studio";

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
