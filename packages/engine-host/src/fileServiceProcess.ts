// fileServiceProcess.ts — start, watch and stop the engine-side file service, which
// serves workspaces and every file op to the browser (the C++ engine stays file-free).
// Spawns only when nothing already answers the port and a runtime resolves; otherwise
// reports FAILED rather than a green lie. Full rationale: docs/supervisorPolicy.md.

import { type ChildProcess, spawn } from "node:child_process";
import { killTree } from "@studio/engine-client/processTree";
import * as bundle from "./bundle.ts";
import type { EngineIdentity } from "./identity.ts";
import { line, pump } from "./logbus.ts";
import { isServing } from "./portProbe.ts";

/** Re-exported so `fileService.isServing(...)` keeps reading as one thing to its callers. */
export { isServing };

export type SpawnResult =
  | { kind: "spawned"; child: ChildProcess }
  /** Someone else is serving the port — the dev watcher. Not a failure. */
  | { kind: "foreign" }
  /** No runtime to spawn and nothing answering. The red-icon case. */
  | { kind: "unavailable" };

/** Ensure a file service is serving `filePort`, spawning one if we can; every start path goes through here, so the probe is never skipped. */
export async function ensure(
  identity: EngineIdentity,
  enginePort: number,
  filePort: number,
  registryUrl: string,
  /** The media library root, when the user moved it off the system drive. */
  mediatekDir: string | null = null,
  /** The hosted library this machine caches, and the token to reach it. */
  mediatek: { url: string | null; token: string | null } = {
    url: null,
    token: null,
  },
): Promise<SpawnResult> {
  if (await isServing(filePort)) return { kind: "foreign" };

  const runtime = bundle.fileServiceRuntime();
  if (!runtime) return { kind: "unavailable" };

  const child = spawn(runtime.node, [runtime.script], {
    // Its own process group, so killTree can reach the helpers it forks.
    detached: true,
    // Piped, never inherited: our stdout is the tray protocol, and one stray child line would corrupt the frames.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      STUDIO_ENGINE_PORT: String(enginePort),
      STUDIO_FILE_PORT: String(filePort),
      STUDIO_ENGINE_ID: identity.id,
      STUDIO_ENGINE_TOKEN: identity.token,
      // The file service builds part of its allowlist from this; pass the resolved URL down so the child can't differ.
      STUDIO_REGISTRY_URL: registryUrl,
      // A packaged app has no useful PATH: point the file service at the staged demo songs, or a new workspace opens empty.
      ...(bundle.demos() ? { STUDIO_DEMOS: bundle.demos() as string } : {}),
      // Only when set: unset falls back to ~/.studio/mediatek, while an empty string would read as "the current directory".
      ...(mediatekDir ? { STUDIO_MEDIATEK: mediatekDir } : {}),
      // Only when configured: with no URL the local folder is simply not a cache of anything, which is a working state.
      ...(mediatek.url ? { MEDIATEK_URL: mediatek.url } : {}),
      ...(mediatek.token ? { MEDIATEK_TOKEN: mediatek.token } : {}),
    },
  });
  if (child.stdout) pump(child.stdout, "file");
  if (child.stderr) pump(child.stderr, "file");
  line("host", `file service started (pid ${child.pid}) on :${filePort}`);
  return { kind: "spawned", child };
}

/** Stop a file service WE spawned, tree and all; a no-op for a foreign one, since killing someone else's dev watcher is not ours to do. */
export function stop(child: ChildProcess | null): void {
  if (!child?.pid) return;
  killTree(child.pid);
}
