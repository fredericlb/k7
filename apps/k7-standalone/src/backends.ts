// backends.ts — k7's own server, as the shell runs any server: under Electron as node, dying with the app, restarted when it crashes.
// Packaged it is the bundle the phone runs too (apps/k7/backend/docs/standalone.md); unpackaged, the checkout's source under tsx.

import { join } from "node:path";
import { keepAliveDialog } from "@frediverse/electron-shell/dialogs";
import { type Server, startServer } from "@frediverse/electron-shell/servers";
import { app } from "electron";
import { backendBundle, sourceRoot, stateDirs } from "./paths.ts";

/** Restarted on the shell's backoff; past its limit, the person chooses Restart or Quit (docs/standalone.md, "A crash"). */
const keepAlive = () =>
  keepAliveDialog({
    title: "k7",
    logPath: stateDirs().log,
    onQuit: () => app.quit(),
  });

/** Start k7's backend on `port`, with `env` over this process's own. */
export function startBackend(
  port: number,
  env: Record<string, string>,
  cwd: string,
): Server {
  const common = { name: "k7", port, cwd, unset: ["TRUSTED_ORIGINS"] };
  const bundle = backendBundle();
  if (bundle)
    return startServer(
      {
        ...common,
        entry: join(bundle, "bin", "backend.mjs"),
        // The hub would otherwise start the file service with tsx over a source that is not shipped.
        env: {
          ...env,
          STUDIO_FILE_SERVICE_ENTRY: join(bundle, "bin", "file-service.mjs"),
        },
      },
      keepAlive(),
    );
  const root = sourceRoot();
  const dir = join(root, "apps", "k7", "backend");
  return startServer(
    {
      ...common,
      entry: join(dir, "src", "server.ts"),
      tsx: join(root, "node_modules", "tsx", "dist", "cli.mjs"),
      tsconfig: join(dir, "tsconfig.json"),
      env,
    },
    keepAlive(),
  );
}
