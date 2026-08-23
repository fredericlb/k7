// repoLookup.ts — the two calls an editor makes to pl8: the git URI behind the short name in
// its own address, and the account's library repository. Separate from project.ts because that
// file is the FILE SERVICE's routes, on the engine's machine; this is the hosted médiathèque,
// same origin as the page.

import type { RepoRef } from "@studio/web-protocol";
import { serviceUrl } from "@studio/web-protocol/services";

/** Where pl8 answers, asked of the table rather than spelled — see docs/fileApi.md. */
const pl8 = (): string => serviceUrl(globalThis.location?.origin ?? "", "pl8");

/** A refusal in the SERVER's words, since it is the side that can be specific. */
async function failed(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(body.error ?? fallback);
  e.status = res.status;
  return e;
}

/** Resolve `/<repo>/…`'s repo name to the repository pl8 holds under it — docs/fileApi.md. */
export async function repoByName(name: string): Promise<RepoRef> {
  const res = await fetch(
    `${pl8()}/api/projects/by-name/${encodeURIComponent(name)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok)
    throw await failed(res, `could not resolve the repository '${name}'`);
  return res.json() as Promise<RepoRef>;
}

/** The account's LIBRARY repository, or null — and `null` is a 200. See docs/fileApi.md. */
export async function librariesRepo(): Promise<RepoRef | null> {
  const res = await fetch(`${pl8()}/api/projects/libraries`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await failed(res, "could not ask pl8 for the libraries");
  return (await res.json()).libraries ?? null;
}
