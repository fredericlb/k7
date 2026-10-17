// clipFiles.ts — putting bytes into a project's `clips/` and declaring them. Two writes, shared by
// the timeline's file DROP and by a recorded picture TAKE, which do the same thing for different
// reasons and must not drift on the one that matters: an existing declaration is never overwritten.
// A name already taken by DIFFERENT bytes is not reused: the clip gets the next free id. See
// apps/k7/frontend/docs/timeline.md, "Same name, different file".

import { mediaUrl } from "@studio/project-shell/fileApi";
import { api } from "./api";
import { projectDir } from "./projectPaths";
import { clipDecl } from "./timelineDrop";

/** What filing one clip did — the id it was filed under, and `reused` when that clip was already there with these bytes. */
export interface FiledClip {
  id: string;
  reused: boolean;
}

/** How many `-n` suffixes are tried before giving up: a project holding fifty files called `take` has another problem. */
const MAX_SUFFIX = 50;

/** The `source:` a declaration names, or null when it has none. */
export const declaredSource = (yaml: string): string | null =>
  /^source:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(yaml)?.[1] ?? null;

/** The candidate ids for `id`, in order: itself, then `id-2`, `id-3`… */
export const candidateIds = (id: string, n = MAX_SUFFIX): string[] =>
  Array.from({ length: n }, (_, i) => (i === 0 ? id : `${id}-${i + 1}`));

/** The size of a file already in the project, or null when it is not there or the service will not say. */
async function sizeOf(path: string): Promise<number | null> {
  try {
    const res = await fetch(mediaUrl(path), { method: "HEAD" });
    if (!res.ok) return null;
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** File `upload` under the first id whose existing file, if any, is these bytes — a reused declaration is KEPT, trims and all. */
export async function fileClip(
  project: string,
  clip: { id: string; upload: string },
  bytes: ArrayBuffer,
  onProgress?: (loaded: number) => void,
): Promise<FiledClip> {
  const dir = projectDir(project);
  const prefix = dir ? `${dir}/` : "";
  const dot = clip.upload.lastIndexOf(".");
  const ext = dot > 0 ? clip.upload.slice(dot) : "";
  // Same size is taken as same file: a re-drop of one recording must not pile up copies of it.
  const same = async (upload: string) =>
    (await sizeOf(`${prefix}clips/${upload}`)) === bytes.byteLength;

  for (const id of candidateIds(clip.id)) {
    const upload = `${id}${ext}`;
    const decl = `${prefix}clips/${id}.yaml`;
    const existing = await api.read(decl).then(
      (r) => r.content,
      (e: { status?: number }) => {
        if (e.status === 404) return null;
        throw e;
      },
    );
    if (existing !== null) {
      // Declared already: reused only when it names this file and the file is these bytes.
      if (
        declaredSource(existing) === `clips/${upload}` &&
        (await same(upload))
      )
        return { id, reused: true };
      continue;
    }
    try {
      await api.uploadWithProgress(`${prefix}clips`, upload, bytes, onProgress);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status !== 409) throw err;
      // Bytes there with no declaration: they are ours only when they are the same.
      if (!(await same(upload))) continue;
    }
    await api.write(decl, clipDecl(upload));
    return { id, reused: false };
  }
  throw new Error(
    `clips/ already holds ${MAX_SUFFIX} different files called ${clip.id}`,
  );
}
