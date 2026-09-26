// fileHub.ts — pl8 hosts the accounts' WORKSPACES under `$STUDIO_FILES_ROOT`: one file service per
// account, beside the registry whose tunnels reach the engines that play them. It is the only place
// a workspace lives, so a pl8 without it refuses to start rather than serve an origin where no
// project can open. See packages/file-hub/docs/fileHub.md.

import type { EngineMount } from "@studio/engine-registry";
import { FILE_HUB_HELLO, FILE_HUB_PATH, FileHub } from "@studio/file-hub";
import { mediatekDir } from "@studio/mediatek/layout";
import type { Express, RequestHandler } from "express";

/** `$STUDIO_FILES_ROOT`, or the process exits with what to set — called before anything listens. */
export function requireFilesRoot(): string {
  const dataRoot = process.env.STUDIO_FILES_ROOT?.trim();
  if (dataRoot) return dataRoot;
  console.error(
    "✗ $STUDIO_FILES_ROOT is not set — it is where the accounts' workspaces live, and there is no other place.\n" +
      "  Set it to a writable folder (env.yaml's pl8-backend in dev, the compose file in production).",
  );
  process.exit(1);
}

export function mountFileHub(
  app: Express,
  engine: EngineMount,
  requireAuth: RequestHandler,
  port: number,
  dataRoot: string,
  issueApiToken: (sub: string) => string,
): FileHub {
  const hub = new FileHub({
    dataRoot,
    mediatekRoot: mediatekDir(),
    // Each account's service calls THIS process back over loopback, as that account.
    mediatekLink: (user) => ({
      url: `http://127.0.0.1:${port}`,
      token: issueApiToken(user),
    }),
    registry: engine.registry,
    tunnels: engine.tunnels,
    selfPort: () => port,
    userOf: (req) => req.user?.email ?? "",
    // Set by `npm run dev` only: this process's own watch cannot see the ones it spawns.
    watchSources: process.env.STUDIO_FILES_WATCH === "1",
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
