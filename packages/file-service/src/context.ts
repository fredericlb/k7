// context.ts — per-request identity + workspace resolution. The user header is set by the file
// hub from the caller's ticket or session, and a client's own is dropped before it gets here
// (packages/file-hub/docs/fileHub.md); the hub's secret, checked before this, is the gate.

import { USER_HEADER, WORKSPACE_HEADER } from "@studio/web-protocol";
import type { RequestHandler } from "express";
import { getWorkspace, UnknownWorkspaceError } from "./workspaces.ts";

// The authenticated user's email, as the hub stamped it. 400 if absent.
export const resolveUser: RequestHandler = (req, res, next) => {
  const email = req.get(USER_HEADER);
  if (!email) return res.status(400).json({ error: "missing user header" });
  req.userEmail = email;
  // Who the ROOT belongs to is owner.ts's to decide, not the latest caller's.
  next();
};

// The chosen workspace → a live Workspace instance on req.ws. 400 if absent/invalid.
export const resolveWorkspace: RequestHandler = (req, res, next) => {
  const workspace = req.get(WORKSPACE_HEADER);
  if (!workspace)
    return res.status(400).json({ error: "missing workspace header" });
  try {
    req.ws = getWorkspace(req.userEmail!, workspace);
    next();
  } catch (e) {
    // 404 "isn't there" vs 400 "isn't a usable name": the browser sends the user back to the picker only for one.
    const code = e instanceof UnknownWorkspaceError ? 404 : 400;
    res.status(code).json({ error: (e as Error).message });
  }
};
