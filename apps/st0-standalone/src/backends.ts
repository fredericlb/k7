// backends.ts — st0's own server, as the shell runs any server: unchanged, under tsx, dying with the app.
// What is st0's here is only where it lives in the source tree (packages/electron-shell/docs/shell.md).

import { join } from "node:path";
import { type Server, startServer } from "@studio/electron-shell/servers";
import { sourceRoot } from "./paths.ts";

/** Start `apps/<app>/backend/src/server.ts` on `port`, with `env` over this process's own. */
export function startBackend(
  app: "st0",
  port: number,
  env: Record<string, string>,
  cwd: string,
): Server {
  const root = sourceRoot();
  const dir = join(root, "apps", app, "backend");
  return startServer({
    name: app,
    port,
    entry: join(dir, "src", "server.ts"),
    tsx: join(root, "node_modules", "tsx", "dist", "cli.mjs"),
    tsconfig: join(dir, "tsconfig.json"),
    env,
    unset: ["TRUSTED_ORIGINS"],
    cwd,
  });
}
