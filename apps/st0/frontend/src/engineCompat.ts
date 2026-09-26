// engineCompat.ts — how compatible each candidate engine is with the project in the ADDRESS,
// measured before one is chosen: EngineGate compares this first when it picks for you. Two
// roads, by where the project's files live:
//   • on the SERVER (hosted files): the server lists the project's needs with no engine bound,
//     and each engine's catalogue is asked of the engine itself — scored here;
//   • on the ENGINE'S MACHINE: that machine's file service scores the project against its own
//     engine's scan (`/project-compat`) — each candidate answers for itself.
// One formula either way, @studio/web-protocol/compat. See @studio/engine-browser/docs/access.md.

import {
  type Compatibility,
  compatibility,
  type PluginNeed,
  pluginCatalogue,
} from "@studio/engine-browser/compat";
import { fileTokenOf } from "@studio/engine-browser/probe";
import { parseLaunch } from "@studio/project-shell/launch";
import {
  ENGINE_TOKEN_HEADER,
  USER_HEADER,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import { isLocal, localTarget } from "@studio/web-protocol/projects";
import { api, engines } from "./api";
import type { RankedEngine } from "./types";

/** The project the address names, as a workspace and a path in it; null for anything else — the bench's is only known once opened. */
function addressedProject(): { workspace: string; project: string } | null {
  const target = parseLaunch(
    window.location.pathname,
    "st0",
    import.meta.env.BASE_URL,
  );
  return target && isLocal(target.repo) ? localTarget(target.project) : null;
}

/** GET one file-service route for the addressed project, or null on any failure — a score that cannot be had is not a fault. */
async function askFiles<T>(
  fileBase: string,
  token: string,
  route: string,
  at: { workspace: string; project: string },
  user: string,
): Promise<T | null> {
  try {
    const res = await fetch(
      `${fileBase}${route}?project=${encodeURIComponent(at.project)}`,
      {
        headers: {
          [USER_HEADER]: user,
          [WORKSPACE_HEADER]: at.workspace,
          [ENGINE_TOKEN_HEADER]: token,
        },
      },
    );
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Each usable candidate's compatibility, by engine id; one that could not tell is absent. Empty when the address names no project. */
export async function compatByEngine(
  ranked: RankedEngine[],
): Promise<Map<string, Compatibility>> {
  const out = new Map<string, Compatibility>();
  const at = addressedProject();
  if (!at) return out;
  const candidates = ranked.flatMap((r) => {
    const token = fileTokenOf(r);
    return r.latency && r.wsUrl && r.fileBase && token && !r.engine.assigned
      ? [{ r, wsUrl: r.wsUrl, fileBase: r.fileBase, token }]
      : [];
  });
  if (!candidates.length) return out;
  const me = await api.getMe().catch(() => null);
  const user = me?.email || me?.sub || "unknown";

  // Hosted: the needs once, from the server, with no engine in the ticket — every candidate plays the same files.
  const hosted = candidates.some((c) => c.r.filesHosted)
    ? await engines.hostedFiles()
    : null;
  const needs = hosted
    ? ((
        await askFiles<{ plugins: PluginNeed[] }>(
          hosted.fileBase,
          hosted.fileToken,
          "/project-plugins",
          at,
          user,
        )
      )?.plugins ?? null)
    : null;

  await Promise.all(
    candidates.map(async (c) => {
      if (c.r.filesHosted) {
        if (!needs) return;
        // Nothing to look for: every engine has all of nothing, and asking would only cost the wait.
        const catalogue = needs.length ? await pluginCatalogue(c.wsUrl) : [];
        if (catalogue) out.set(c.r.engine.id, compatibility(needs, catalogue));
        return;
      }
      // On the engine's machine: its file service knows its engine's scan and scores for itself.
      const reply = await askFiles<{ compat: Compatibility | null }>(
        c.fileBase,
        c.token,
        "/project-compat",
        at,
        user,
      );
      if (reply?.compat) out.set(c.r.engine.id, reply.compat);
    }),
  );
  return out;
}
