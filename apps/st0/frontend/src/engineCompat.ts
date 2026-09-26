// engineCompat.ts — how compatible each candidate engine is with the project in the ADDRESS,
// measured before one is chosen: EngineGate compares this first when it picks for you. The
// project's needs come from the server's files, which answer with no engine bound; each
// engine's catalogue from the engine itself. See @studio/engine-browser/docs/access.md.

import {
  type Compatibility,
  compatibility,
  type PluginNeed,
  pluginCatalogue,
} from "@studio/engine-browser/compat";
import { parseLaunch } from "@studio/project-shell/launch";
import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import { isLocal, localTarget } from "@studio/web-protocol/projects";
import { api, engines } from "./api";
import type { RankedEngine } from "./types";

/** The plugins the addressed project needs; null when that cannot be told — no `@local` project, no hosted files, no answer. */
export async function addressedProjectNeeds(): Promise<PluginNeed[] | null> {
  try {
    const target = parseLaunch(
      window.location.pathname,
      "st0",
      import.meta.env.BASE_URL,
    );
    const local =
      target && isLocal(target.repo) ? localTarget(target.project) : null;
    if (!local) return null;
    const [hosted, me] = await Promise.all([
      engines.hostedFiles(),
      api.getMe().catch(() => null),
    ]);
    if (!hosted) return null;
    const res = await fetch(
      `${hosted.fileBase}/project-plugins?project=${encodeURIComponent(local.project)}`,
      {
        headers: {
          [USER_HEADER]: me?.email || me?.sub || "unknown",
          [WORKSPACE_HEADER]: local.workspace,
          [ENGINE_TOKEN_HEADER]: hosted.fileToken,
        },
      },
    );
    if (!res.ok) return null;
    return ((await res.json()) as { plugins: PluginNeed[] }).plugins;
  } catch {
    return null;
  }
}

/** Each usable candidate's compatibility, by engine id; one that did not list its plugins in time is absent. */
export async function compatByEngine(
  ranked: RankedEngine[],
  needs: PluginNeed[],
): Promise<Map<string, Compatibility>> {
  const out = new Map<string, Compatibility>();
  const candidates = ranked.flatMap((r) =>
    r.latency && r.wsUrl && r.token && !r.engine.assigned
      ? [{ id: r.engine.id, wsUrl: r.wsUrl }]
      : [],
  );
  // Nothing to look for: every engine has all of nothing, and asking would only cost the wait.
  if (!needs.length) {
    for (const c of candidates) out.set(c.id, compatibility([], []));
    return out;
  }
  await Promise.all(
    candidates.map(async (c) => {
      const catalogue = await pluginCatalogue(c.wsUrl);
      if (catalogue) out.set(c.id, compatibility(needs, catalogue));
    }),
  );
  return out;
}
