// slug.ts — the per-user workspace root, ~/.studio/root/<slug>/<workspace>. The slug
// is the OIDC email with every non-alphanumeric char replaced by "_".

import { join } from "node:path";
import { rootDir, slugify, userRoot } from "@studio/engine-client/paths";

// Re-exported so `./slug` importers keep resolving them; defined in engine-client/paths,
// the shared spelling — the desktop app needs the same slug to migrate a workspace root.
export { rootDir, slugify, userRoot };

// One ordinary path segment, by ALLOWLIST: a denylist lets "." through, which IS the user root.
const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export function assertWorkspaceName(name: string): void {
  if (!name || !WORKSPACE_NAME.test(name) || /^\.+$/.test(name))
    throw new Error(`invalid workspace name: ${name}`);
}

export function workspaceRoot(slug: string, workspace: string): string {
  assertWorkspaceName(workspace);
  return join(userRoot(slug), workspace);
}
