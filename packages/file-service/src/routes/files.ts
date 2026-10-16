// files.ts — the project file API, re-rooted per-workspace. Mounted after
// resolveWorkspace, so `req.ws` is always a Workspace here. Every former store call
// is now a method on that workspace; the command layer takes it explicitly.

import { Router } from "express";
import { commandRouter } from "./commandRoutes.ts";
import { docRouter } from "./docRoutes.ts";
import { entryRouter } from "./entryRoutes.ts";
import { fileRouter } from "./fileRoutes.ts";
import { mediaRouter } from "./mediaRoutes.ts";
import { workspaceRouter } from "./workspaceRoutes.ts";

// /media lives in server.ts, outside the header gates, and there is no single-tab lease — see docs/fileRoutes.md.
// One router per domain, mounted in the order the routes were always registered in.
export const filesRouter: Router = Router();
filesRouter.use(
  workspaceRouter,
  entryRouter,
  commandRouter,
  docRouter,
  mediaRouter,
  fileRouter,
);
