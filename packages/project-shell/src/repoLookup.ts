// repoLookup.ts — the two calls an editor makes to st0: the git URI behind the short name in
// its own address, and the account's library repository. Separate from project.ts because that
// file is the FILE SERVICE's routes, on the engine's machine; this is the hosted médiathèque,
// same origin as the page.

import type { RepoRef } from "@studio/web-protocol";
import { serviceUrl } from "@studio/web-protocol/services";

/** st0, which answers the bare origin — see `@studio/web-protocol/services`. */
const st0 = (): string => serviceUrl(globalThis.location?.origin ?? "", "st0");

/** A refusal in the SERVER's words, since it is the side that can be specific. */
async function failed(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(body.error ?? fallback);
  e.status = res.status;
  return e;
}

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
  const res = await fetch(
    `${st0()}/api/projects/by-name/${encodeURIComponent(name)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok)
    throw await failed(res, `could not resolve the repository '${name}'`);
  return res.json() as Promise<RepoRef>;
}

/**
 * The account's LIBRARY repository — the modules and chains every project inherits — or null.
 *
 * Asked BEFORE the project is resolved, because without it there is no project worth opening:
 * a workspace mounts this repository as a submodule and every `@st0/…` ref in every chain
 * resolves inside it (see `@studio/song`'s docs/sharedFolders.md). A song opened without one
 * would compile with every shared module missing — which reads as a broken song rather than
 * as an account that has not been set up.
 *
 * `null` is a 200 and not a 404: "none set" is the ordinary state of a new account, and a
 * status code is the wrong place to keep the difference between that and a service that is
 * down. Only the second is worth a diagnosis.
 */
export async function librariesRepo(): Promise<RepoRef | null> {
  const res = await fetch(`${st0()}/api/projects/libraries`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await failed(res, "could not ask st0 for the libraries");
  return (await res.json()).libraries ?? null;
}
