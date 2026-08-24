// slug.ts — the per-user workspace root, ~/.studio/root/<slug>/<workspace>. The slug
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
