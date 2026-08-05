// launch.ts — which project this editor was opened on. Neither l8 nor m9 picks a workspace:
// st0 owns the repositories and links to them with `?repo=&project=`, and this reads that
// ONCE, at import time, before any router can rewrite the address. See docs/launch.md.

import type { ProjectApp } from "@studio/web-protocol/projects";
import { serviceUrl } from "@studio/web-protocol/services";

/** Remembered per tab, so a reload lands back on the same project rather than at st0. */
const KEY = "studio.launch";

export interface Launch {
  /** The SSH git URI, exactly as st0 holds it. */
  repo: string;
  /** The project folder inside the repository; "." when the repository IS the project. */
  project: string;
}

/** Pure, so the parsing can be tested without a DOM — this repo's suites run in node. */
export function parseLaunch(search: string): Launch | null {
  const q = new URLSearchParams(search);
  const repo = q.get("repo");
  if (!repo) return null;
  return { repo, project: q.get("project") || "." };
}

/**
 * Remember this tab's target — called by the gate once the project has actually OPENED, and
 * deliberately not at import.
 *
 * Remembering on arrival meant remembering a target that turns out not to work: st0 names a
 * project out of a mirror that can be behind the machine's clone, and a tab that had been
 * handed a folder the clone does not have replayed it on every reload and every Retry, with
 * no way back except the one button on the error screen. What is worth surviving a refresh is
 * a project you were WORKING on, and that is exactly what this now stores.
 */
export function rememberLaunch(l: Launch): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* private mode — this tab still works, a reload just goes back to st0 */
  }
}

function remembered(): Launch | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const l = JSON.parse(raw) as Launch;
    return l?.repo ? l : null;
  } catch {
    return null;
  }
}

/**
 * READ AT IMPORT, and that is the whole point of this module existing.
 *
 * `useViewRoute` rewrites the address on every state change (`replace`), and what it writes
 * comes from `routes.ts`, which knows nothing about these two parameters — so they are gone
 * within a frame of the first render. Reading them here, before React mounts, is what makes
 * that harmless.
 */
// `globalThis.location`, not `window`, for the reason api.ts gives at MEDIATEK_URL: this
// module is imported by tests that run in node, where `window` is not defined at all.
const captured = parseLaunch(globalThis.location?.search ?? "");

/** Where this editor was pointed, or null — which means "you did not come from st0". */
export function launchTarget(): Launch | null {
  return captured ?? remembered();
}

/** Forget it, for the way back out. */
export function clearLaunch(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Where a project opens — l8 or m9, whichever its folder name claims.
 *
 * `origin` may be any URL on the studio origin; `serviceUrl` keeps only the origin, so a
 * caller can pass `window.location.href` without stripping anything first.
 */
export function launchUrl(
  origin: string,
  repo: string,
  project: string,
  app: ProjectApp,
): string {
  const q = new URLSearchParams({ repo, project });
  return `${serviceUrl(origin, app)}/?${q.toString()}`;
}

/** Where projects are chosen: st0's Projets section, which is also its home page. */
export function projectsUrl(origin: string): string {
  return `${serviceUrl(origin, "st0")}/projects`;
}
