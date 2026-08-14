// library.ts — the shared module libraries, as l8 reads and writes them. A FOURTH destination
// for this browser: st0's own `/api/mediatek` routes, same-origin and on the session cookie,
// because the médiathèque is the only editable catalogue and its files are not on any workspace.
// Why the tab exists and what an edit here costs: docs/sharedModules.md.

import type { FamilyListing } from "@studio/mediatek/types";
import { fsend } from "@studio/project-shell/fileApi";
import { libraryModuleStore } from "@studio/ui-module-builder/library-store";
import type { ModuleStore } from "@studio/ui-module-builder/store";
import { api, MEDIATEK_URL } from "./api";

/** The one family this tab draws. Chains and songs are the médiathèque's own screens. */
const FAMILY = "modules";

const fileUrl = (path: string): string =>
  `${MEDIATEK_URL}/api/mediatek/file?path=${encodeURIComponent(path)}`;

/** What a refusal SAID, when it said anything — the route answers `{error}` for every 4xx. */
async function failed(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const e: Error & { status?: number } = new Error(
    body.error ?? `${what} ${res.status}`,
  );
  e.status = res.status;
  return e;
}

/**
 * The catalogue's whole modules family, from st0 — not from this machine's cache.
 *
 * The cache holds only what the OPEN projects name (`@studio/file-service`'s
 * docs/mediatekPull.md), so listing it would show a library that shrinks and grows with the
 * song you happen to have open. The hosted service is the library; the cache is what the engine
 * plays from, which is a different question and is answered after a write, below.
 */
export async function listLibraryModules(): Promise<FamilyListing> {
  const res = await fetch(
    `${MEDIATEK_URL}/api/mediatek/list?family=${FAMILY}`,
    // The session cookie, which is this origin's — st0 answers the root and owns /auth.
    { credentials: "same-origin" },
  );
  if (!res.ok) throw await failed(res, "library listing");
  return res.json() as Promise<FamilyListing>;
}

/** One library file's text, or null when the library hasn't got it. Absent is not an error. */
export async function readLibraryFile(path: string): Promise<string | null> {
  const res = await fetch(fileUrl(path), { credentials: "same-origin" });
  if (res.status === 404) return null;
  if (!res.ok) throw await failed(res, "library file");
  return res.text();
}

/**
 * Write one library file back, and then bring THIS machine's cache in line.
 *
 * Two steps and in this order, because they answer two different questions. The library is
 * st0's volume and is what everyone else will read; the cache under `~/.studio/mediatek` is
 * what the engine beside you loads a plugin from. Writing only the first would leave the module
 * you just edited sounding like the one you opened until something else happened to sync.
 *
 * The sync is best-effort and is not allowed to fail the save: the bytes are in the library, so
 * an engine that is unreachable costs the audition and not the work — the same order of
 * priorities `pushModuleToMediatek` states from the other side.
 */
export async function writeLibraryFile(
  path: string,
  content: string,
): Promise<void> {
  const res = await fetch(fileUrl(path), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/octet-stream" },
    body: content,
  });
  if (!res.ok) throw await failed(res, "library write");
  try {
    await fsend<unknown>("POST", "/mediatek/sync", { family: FAMILY });
  } catch (e) {
    console.warn(
      `saved to the médiathèque, but this machine's cache did not refresh: ${(e as Error).message}`,
    );
  }
}

/**
 * The builder's view of the médiathèque — the shared implementation, over l8's transport.
 *
 * A SECOND store beside `moduleStore`, not a path-aware one, and that is the point: both path
 * spaces spell a module `modules/<type>/<sub>/module.yaml`, so one store deciding between them
 * by looking at a path would be choosing between two files that are named the same and are not
 * the same file. Which store the builder gets is decided where the click came from — the
 * project tab or the Libraries tab — and never re-derived afterwards.
 */
export const libraryStore: ModuleStore = libraryModuleStore({
  read: readLibraryFile,
  write: writeLibraryFile,
  // The OPEN PROJECT's hints, not an empty set. A shared module is completed against the
  // vocabulary of the song you are in — its base modules, its params — which is more than a
  // library could ever say about itself, and is the same reason the builder finds a live plugin
  // here at all. See docs/sharedModules.md.
  hints: () => api.hints(),
});
