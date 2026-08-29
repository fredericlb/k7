// hostCmd.ts — where the supervisor (@studio/engine-host) lives and how to run it, in three
// tiers: $STUDIO_ENGINE_HOST_CMD, the packaged node + engine-host.mjs, or the repo's tsx on
// the TypeScript source. Says clearly when the answer is "nothing" — an app that silently
// supervises nothing looks exactly like a healthy one. See docs/lifetime.md.

import { statSync } from "node:fs";
import { dirname, join } from "node:path";

/** A resolved supervisor command: the program and its arguments. */
export interface HostCmd {
  program: string;
  args: string[];
}

/**
 * What resolution needs to know about the app around it. Passed in rather than read from
 * `electron`, so this file — which decides the one argv that fails silently when wrong —
 * can be tested without a browser process.
 */
export interface Packaging {
  packaged: boolean;
  resourcesPath: string;
}

/**
 * Trust the OS certificate store, not just Node's bundled Mozilla set. NOT a preference: a web
 * UI added from this app is routinely behind a local proxy with a private CA, which exists in
 * the OS store and nowhere else — and without this the heartbeat fails the handshake SILENTLY
 * (a registry merely down must not be an error), so the engine never appears in that UI's
 * picker. Node >= 22.15; an older dev `node` exits with `bad option`, which the merged log
 * shows verbatim. `NODE_EXTRA_CA_CERTS` keeps working alongside it.
 *
 * This is also why the supervisor stays a child of a VENDORED node rather than running inside
 * Electron: the flag belongs to a Node version we ship, not to one Electron happens to embed.
 */
const USE_SYSTEM_CA = "--use-system-ca";

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The monorepo root: `$STUDIO_REPO_ROOT`, else walk up until a directory holding
 * `engine/moteur` appears. Unpackaged, __dirname is inside the repo, which is what makes the
 * dev tier resolve without configuration.
 */
export function repoRoot(): string | null {
  const env = process.env.STUDIO_REPO_ROOT;
  if (env && isDir(env)) return env;
  let dir = __dirname;
  for (;;) {
    if (isDir(join(dir, "engine", "moteur"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * The vendored (node, engine-host.mjs) pair of a packaged app. Both are FLAT in
 * `process.resourcesPath` — see electron-builder.yml: engine-host derives its own resource
 * dir from `process.execPath`, which for that child is the vendored node, so anything it
 * looks for has to be node's sibling.
 */
function bundled(pkg: Packaging): HostCmd | null {
  if (!pkg.packaged) return null;
  const dir = pkg.resourcesPath;
  const node = join(dir, process.platform === "win32" ? "node.exe" : "node");
  const script = join(dir, "engine-host.mjs");
  if (!isFile(node) || !isFile(script)) return null;
  return { program: node, args: [USE_SYSTEM_CA, script] };
}

/** The repo's tsx CLI on the supervisor's source, under whatever `node` is on PATH — a dev machine has one. */
function fromRepo(): HostCmd | null {
  const root = repoRoot();
  if (!root) return null;
  const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const entry = join(root, "packages", "engine-host", "src", "main.ts");
  if (!isFile(tsx) || !isFile(entry)) return null;
  return { program: "node", args: [USE_SYSTEM_CA, tsx, entry] };
}

/**
 * Resolve the supervisor command, or null — a hard failure host.ts turns into
 * "⚠ supervisor not found" rather than leaving a green icon over an empty stack.
 */
export function resolve(pkg: Packaging): HostCmd | null {
  const override = process.env.STUDIO_ENGINE_HOST_CMD;
  // Run with NO arguments: a custom supervisor build brings its own.
  if (override && isFile(override)) {
    return { program: override, args: [] };
  }
  return bundled(pkg) ?? fromRepo();
}
