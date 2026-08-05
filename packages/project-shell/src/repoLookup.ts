// repoLookup.ts — the one call an editor makes to st0: the git URI behind the short name in
// its own address. Separate from project.ts because that file is the FILE SERVICE's routes,
// on the engine's machine; this is the hosted médiathèque, same origin as the page.

import type { RepoRef } from "@studio/web-protocol";
import { serviceUrl } from "@studio/web-protocol/services";

/**
 * Resolve `/l8/<repo>/…`'s repo name to the repository st0 holds under it.
 *
 * Same origin as the page — every studio service sits at a fixed path under one origin — so
 * the session cookie rides along without asking, and there is no CORS to arrange. It is st0
 * that must answer: it owns the repositories, and it is the only side that knows the URI.
 *
 * The error is the SERVER's words, because it is the one that can be specific (unknown name,
 * or a name two repositories answer to).
 */
export async function repoByName(name: string): Promise<RepoRef> {
  const base = serviceUrl(globalThis.location?.origin ?? "", "st0");
  const res = await fetch(
    `${base}/api/projects/by-name/${encodeURIComponent(name)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const e: Error & { status?: number } = new Error(
      body.error ?? `could not resolve the repository '${name}'`,
    );
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<RepoRef>;
}
