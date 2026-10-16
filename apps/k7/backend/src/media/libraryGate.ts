// libraryGate.ts — who may take something OUT of the médiathèque: one library every account shares,
// so a removal, a folder move or a move that replaces a file is an admin's, or the device's own user's.
// The thing a reader would get wrong: a song is a FOLDER, so deleting one is a subtree delete too.
// See ../../docs/media/gate.md.

import { existsSync, statSync } from "node:fs";
import { writablePath } from "@studio/mediatek/layout";
import type { Request, Response } from "express";
import { isAdminRequest } from "./admin.ts";

/** The answer a refused caller reads; the UI hides the gesture, so this is for scripts and stale tabs. */
export const MANAGE_REFUSED =
  "only an admin may remove or move folders in the shared library";

/** Whether this request may remove from, or reshape, the library. */
export function mayManageLibrary(req: Request): boolean {
  // A device's own backend answers loopback only, and its library is that machine's alone.
  if (process.env.STUDIO_LOCAL_USER === "1") return true;
  return isAdminRequest(req);
}

/** Answer 403 and return false when the request may not; the caller returns on false. */
export function allowManage(req: Request, res: Response): boolean {
  if (mayManageLibrary(req)) return true;
  res.status(403).json({ error: MANAGE_REFUSED });
  return false;
}

/** Whether a move reshapes the library rather than renaming one file: a folder, or a destination it would replace. */
export function moveNeedsManager(from: string, to: string): boolean {
  const src = writablePath(from);
  const dst = writablePath(to);
  let dir = false;
  try {
    dir = statSync(src).isDirectory();
  } catch {
    // A source that is not there fails in the move itself, with its own error.
  }
  return dir || existsSync(dst);
}
