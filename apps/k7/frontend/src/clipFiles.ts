// clipFiles.ts — putting bytes into a project's `clips/` and declaring them. Two writes, shared by
// the timeline's file DROP and by a recorded picture TAKE, which do the same thing for different
// reasons and must not drift on the one that matters: an existing declaration is never overwritten.
// See apps/k7/frontend/docs/timeline.md.

import { api } from "./api";
import { projectDir } from "./projectPaths";
import { clipDecl } from "./timelineDrop";

/** What filing one clip did — `reused` when the declaration was already there and was left alone. */
export interface FiledClip {
  id: string;
  reused: boolean;
}

/**
 * Upload `upload` into the project's `clips/` and make sure `clips/<id>.yaml` declares it.
 *
 * A name already on disk (409) is not an error: the bytes are there, and the caller carries on with
 * them. An existing declaration is KEPT — it may hold a trim, a warp or corrected onsets, and
 * neither a drop nor a take knows any of them.
 */
export async function fileClip(
  project: string,
  clip: { id: string; upload: string },
  bytes: ArrayBuffer,
  onProgress?: (loaded: number) => void,
): Promise<FiledClip> {
  const dir = projectDir(project);
  const prefix = dir ? `${dir}/` : "";
  try {
    await api.uploadWithProgress(
      `${prefix}clips`,
      clip.upload,
      bytes,
      onProgress,
    );
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status !== 409) throw err;
  }
  const path = `${prefix}clips/${clip.id}.yaml`;
  try {
    await api.read(path);
    return { id: clip.id, reused: true };
  } catch {
    await api.write(path, clipDecl(clip.upload));
    return { id: clip.id, reused: false };
  }
}
