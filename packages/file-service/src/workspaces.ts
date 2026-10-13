// workspaces.ts — the live set of Workspace instances, one per (userSlug, workspace),
// plus listing a user's workspaces for the picker.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { projectSurfaces } from "@studio/song/surfaces";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { projectTagsOf } from "@studio/song-schema/projectTags";
import type {
  AccountWorkspace,
  SurfacedProject,
  WorkspaceSummary,
} from "@studio/web-protocol";
import { projectApp } from "@studio/web-protocol/projects";
import { BENCH_WORKSPACE } from "./bench.ts";
import { attachLiveCapture, detachLiveCapture } from "./liveSync.ts";
import { closeModuleWatchesUnder } from "./moduleWatch.ts";
import { rootOwner } from "./owner.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import {
  activeMarkerOf,
  isProjectDir,
  projectDirsUnder,
  readActiveMarker,
  Workspace,
} from "./workspace.ts";

// Memoized so a workspace's caches (compiled doc, waveforms) persist across requests.
const live = new Map<string, Workspace>();

/** Thrown when a request names a workspace that isn't there, as a type so the HTTP layer can answer 404. */
export class UnknownWorkspaceError extends Error {
  constructor(name: string) {
    super(`unknown workspace: ${name}`);
    this.name = "UnknownWorkspaceError";
  }
}

/** The Workspace for an EXISTING folder — opening does NOT create, see docs/workspaces.md. */
export function getWorkspace(userEmail: string, workspace: string): Workspace {
  const slug = slugify(userEmail);
  const key = `${slug}/${workspace}`;
  // workspaceRoot() throws on a traversing/empty name; that stays a 400.
  const root = workspaceRoot(workspace);
  // Before the memo, every call: a folder deleted from Finder would else be served from cache and 500 deep in fs.
  if (!existsSync(root)) {
    live.delete(key);
    detachLiveCapture(root);
    throw new UnknownWorkspaceError(workspace);
  }
  let ws = live.get(key);
  if (!ws) {
    ws = new Workspace(root);
    live.set(key, ws);
    attachLiveCapture(ws, workspace);
  }
  return ws;
}

/** Make sure `name` exists here and is synced, as the relay's rooms ask; nothing when no account has claimed this root. */
export function joinWorkspace(name: string): void {
  const owner = rootOwner();
  if (!owner) return;
  try {
    const root = workspaceRoot(name);
    if (!existsSync(root)) {
      mkdirSync(root, { recursive: true });
      forgetListing(slugify(owner));
    }
    getWorkspace(owner, name);
  } catch (e) {
    console.warn(
      `sync | cannot join workspace '${name}': ${(e as Error).message}`,
    );
  }
}

/** Sync every workspace on this machine from the start, not only those a request opens: a replica holds them all. */
export function attachAllWorkspaces(): void {
  for (const name of workspaceNames(rootDir())) joinWorkspace(name);
}

/** Every workspace currently open, for the machine-wide jobs that have no request to hang off. */
export function liveWorkspaces(): Workspace[] {
  return [...live.values()];
}

/** Create a workspace folder. Returns false if it was already there. */
export async function createWorkspace(
  userEmail: string,
  workspace: string,
): Promise<boolean> {
  const root = workspaceRoot(workspace);
  if (existsSync(root)) return false;
  mkdirSync(root, { recursive: true });
  forgetListing(slugify(userEmail)); // a folder this service just made must not wait out the window
  return true;
}

/**
 * Remove a workspace from this machine: the folder and everything under it, for good.
 *
 * There is no recycle bin for this one — the bin lives INSIDE a workspace (`_recycle_bin`), so a
 * workspace has nowhere of its own to fall into, which is why the caller asks first.
 *
 * `unload` is not optional on Windows: a handle open anywhere under the folder answers EPERM and
 * the delete half-succeeds — the same wall a person hits deleting it by hand. See docs/workspaces.md.
 */
export async function removeWorkspace(
  userEmail: string,
  workspace: string,
  unload?: (abs: string) => void | Promise<unknown>,
): Promise<void> {
  const root = workspaceRoot(workspace); // validates the name
  if (!existsSync(root)) throw new Error(`no such workspace: ${workspace}`);
  // Every module watch inside it first: `fs.watch` holds a directory, and on Windows that is an
  // EPERM half-way through a removal — the same reason `deleteProject` lets go (docs/moduleWatch.md).
  closeModuleWatchesUnder(root);
  await unload?.(root);
  rmSync(root, { recursive: true, force: true });
  // Its marker is beside it, not in it: a workspace made again under the name must not reopen a ghost.
  rmSync(activeMarkerOf(root), { force: true });
  forgetListing(slugify(userEmail));
}

// Every workspace folder under the user's root; Examples is already there, put by the service's startup (demos.ts).
export function listWorkspaces(_userEmail: string): WorkspaceSummary[] {
  const dir = rootDir();
  const out: WorkspaceSummary[] = [];
  for (const name of workspaceNames(dir)) {
    const abs = join(dir, name);
    const single = isProjectDir(abs);
    out.push({
      name,
      isSingleProject: single,
      projectCount: single ? 1 : projectDirsUnder(abs).length,
    });
  }
  return out;
}

/** The workspace folders under a user root, sorted — the one place the hidden ones are dropped, the BENCH's among them: it is opened by its address, never chosen from a list. */
export function workspaceNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith(".") &&
          e.name !== BENCH_WORKSPACE,
      )
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // no root yet, or unreadable — no workspaces rather than a throw
  }
}

/** Every workspace on this machine, with its projects — what st0's home page draws (docs/workspaces.md). */
export async function listMachineWorkspaces(
  userEmail: string,
): Promise<AccountWorkspace[]> {
  const slug = slugify(userEmail);
  const hit = listings.get(slug);
  if (hit && Date.now() - hit.at < LISTING_RESCAN_MS) return hit.rows;
  const dir = rootDir();
  const names = workspaceNames(dir);
  const rows = names.map((name): AccountWorkspace => {
    const abs = join(dir, name);
    const single = isProjectDir(abs);
    return {
      name,
      isSingleProject: single,
      projects: (single ? ["."] : projectDirsUnder(abs)).flatMap((path) => {
        // `.` names the workspace folder itself; either way the NAME decides, the one rule both ends use.
        const app = projectApp(path === "." ? name : path.split("/").pop()!);
        if (!app) return [];
        const tags = app === "st0" ? tagsOf(join(abs, path)) : [];
        return [tags.length ? { path, app, tags } : { path, app }];
      }),
    };
  });
  listings.set(slug, { at: Date.now(), rows });
  return rows;
}

/** An st0 project's tags, read from its project.yaml; none when there is no such file. */
function tagsOf(projectDir: string): string[] {
  try {
    return projectTagsOf(wsRead(join(projectDir, "project.yaml")));
  } catch {
    return [];
  }
}

/** The window under the listing above, so a polling home page does not walk every tree per tick (docs/workspaces.md). */
const LISTING_RESCAN_MS = 5_000;
const listings = new Map<string, { at: number; rows: AccountWorkspace[] }>();
// Both listings, since the second is built on the first — see docs/workspaces.md.
export const forgetListing = (slug: string) => {
  listings.delete(slug);
  surfaced.delete(slug);
};

/** Every project that DECLARES a surface, flat — what st0's `/external` page draws (docs/workspaces.md). */
export async function listSurfacedProjects(
  userEmail: string,
): Promise<SurfacedProject[]> {
  const slug = slugify(userEmail);
  const hit = surfaced.get(slug);
  if (hit && Date.now() - hit.at < LISTING_RESCAN_MS) return hit.rows;
  const dir = rootDir();
  const workspaces = await listMachineWorkspaces(userEmail);
  const rows: SurfacedProject[] = [];
  for (const w of workspaces) {
    const abs = join(dir, w.name);
    const active = activeOf(abs);
    for (const p of w.projects) {
      const at = p.path === "." ? abs : join(abs, p.path);
      // Diagnostics are dropped on purpose: the place that says WHY a surface will not parse is the editor.
      const { surfaces } = projectSurfaces(at);
      if (!surfaces.length) continue;
      rows.push({
        workspace: w.name,
        path: p.path,
        app: p.app,
        active: active !== null && active === resolve(at),
        surfaces: surfaces.map((s) => ({ id: s.id, type: s.surface.type })),
      });
    }
  }
  surfaced.set(slug, { at: Date.now(), rows });
  return rows;
}

const surfaced = new Map<string, { at: number; rows: SurfacedProject[] }>();

/** The workspace's open project, absolute, straight off the marker file; null when nothing is open. */
const activeOf = (workspaceRootDir: string): string | null =>
  readActiveMarker(workspaceRootDir);
