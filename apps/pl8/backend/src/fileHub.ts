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
  });
  app.get(FILE_HUB_HELLO, requireAuth, (_req, res) => {
    res.json({ path: FILE_HUB_PATH });
  });
  app.use(FILE_HUB_PATH, requireAuth, hub.handler());
  console.log(`   workspaces: hosted under ${dataRoot}`);
  return hub;
}
