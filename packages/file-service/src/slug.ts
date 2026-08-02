// slug.ts — the per-user workspace root, ~/.lanes/root/<slug>/<workspace>. The slug
// is the OIDC email with every non-alphanumeric char replaced by "_".

import { join } from "node:path";
import { rootDir } from "@studio/engine-client/paths";

// Re-exported so `./slug` importers keep resolving it; defined in engine-client/paths, the shared spelling.
export { rootDir };

export function slugify(email: string): string {
  return email.replace(/[^a-zA-Z0-9]/g, "_");
}

export function userRoot(slug: string): string {
  return join(rootDir(), slug);
}

// A workspace name must be one ordinary path segment, checked by ALLOWLIST: the old denylist let "." through,
// and join(userRoot, ".") is the user root — a workspace named "." held a handle over every other one.
const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;

export function assertWorkspaceName(name: string): void {
  if (!name || !WORKSPACE_NAME.test(name) || /^\.+$/.test(name))
    throw new Error(`invalid workspace name: ${name}`);
}

export function workspaceRoot(slug: string, workspace: string): string {
  assertWorkspaceName(workspace);
  return join(userRoot(slug), workspace);
}
