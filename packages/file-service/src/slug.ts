// slug.ts — the workspace root, `<state>/workspace/<workspace>`. There is no per-user level:
// one machine holds one person's workspaces (packages/engine-client/docs/paths.md). The slug
// survives for the SSH keys and the engine session, which are not directories here.

import { join } from "node:path";
import { rootDir, slugify } from "@studio/engine-client/paths";

// Re-exported so `./slug` importers keep resolving them; defined in engine-client/paths.
export { rootDir, slugify };

// One ordinary path segment, by ALLOWLIST: a denylist lets "." through, which IS the root.
const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export function assertWorkspaceName(name: string): void {
  if (!name || !WORKSPACE_NAME.test(name) || /^\.+$/.test(name))
    throw new Error(`invalid workspace name: ${name}`);
}

export function workspaceRoot(workspace: string): string {
  assertWorkspaceName(workspace);
  return join(rootDir(), workspace);
}
