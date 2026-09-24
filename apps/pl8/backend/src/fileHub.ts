// fileHub.ts — pl8 hosts the accounts' WORKSPACES when `$STUDIO_FILES_ROOT` says where: one
// file service per account, beside the registry whose tunnels reach the engines that play them.
// Unset, nothing is mounted and projects stay on the engines' machines. See
// packages/file-hub/docs/fileHub.md.

import type { EngineMount } from "@studio/engine-registry";
import { FILE_HUB_HELLO, FILE_HUB_PATH, FileHub } from "@studio/file-hub";
import { mediatekDir } from "@studio/mediatek/layout";
import type { Express, RequestHandler } from "express";

export function mountFileHub(
  app: Express,
  engine: EngineMount,
  requireAuth: RequestHandler,
  port: number,
): FileHub | null {
  const dataRoot = process.env.STUDIO_FILES_ROOT;
  if (!dataRoot) return null;
  const hub = new FileHub({
    dataRoot,
    mediatekRoot: mediatekDir(),
    registry: engine.registry,
    tunnels: engine.tunnels,
    selfPort: () => port,
    userOf: (req) => req.user?.email ?? "",
    // Stable across restarts, so an open page keeps its ticket through a deploy.
    ticketKey: process.env.SESSION_SECRET
      ? `${process.env.SESSION_SECRET}:files`
      : undefined,
  });
  app.get(FILE_HUB_HELLO, requireAuth, hub.helloHandler());
  // No session guard: a page on another origin carries a ticket, not a cookie — the hub checks it.
  app.use(FILE_HUB_PATH, hub.handler());
  console.log(`   workspaces: hosted under ${dataRoot}`);
  return hub;
}
