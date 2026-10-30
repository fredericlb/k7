// workspaces.ts — the live set of Workspace instances, one per (userSlug, workspace),
// plus listing a user's workspaces for the picker.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { accountLibraryHome } from "@studio/song/sharedFolders";
import { projectSurfaces } from "@studio/song/surfaces";
import { wsRead } from "@studio/song/yaml/workspaceFile";
import { projectTagsOf } from "@studio/song-schema/projectTags";
import type {
  AccountWorkspace,
  SurfacedProject,
  WorkspaceSummary,
} from "@studio/web-protocol";
import { projectApp } from "@studio/web-protocol/projects";
import { activeMarkerOf, readActiveMarker } from "./activeMarker.ts";
import { BENCH_WORKSPACE } from "./bench.ts";
import { EXAMPLES_WORKSPACE, isManagedDemo } from "./demos.ts";
import { liveLogFor } from "./liveLog.ts";
import { loadHead } from "./liveRelay.ts";
import { isPaired } from "./liveServers.ts";
import {
  ACCOUNT_LIBRARY_ROOM,
  attachedAt,
  attachLiveCapture,
  detachLiveCapture,
  endWorkspace,
  roomAt,
} from "./liveSync.ts";
import { closeModuleWatchesUnder } from "./moduleWatch.ts";
import { migrateNamespaceOnce } from "./namespaceStamp.ts";
import { rootOwner } from "./owner.ts";
import { projectEditedAt } from "./projectEdited.ts";
import { rootDir, slugify, workspaceRoot } from "./slug.ts";
import { isProjectDir, projectDirsUnder, Workspace } from "./workspace.ts";

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
export async function attachAllWorkspaces(): Promise<void> {
  // Each step on a turn of its own, so the hub's readiness probe and the first requests answer between them — docs/workspaces.md.
  const turn = (): Promise<void> => new Promise((r) => setImmediate(r));
  await turn();
  // Before joining: a server's sync then carries the rewrite to every device as an ordinary edit.
  migrateLegacyNamespaces();
  for (const name of workspaceNames(rootDir())) {
    await turn();
    joinWorkspace(name);
  }
  await turn();
  attachAccountLibrary();
  // A workspace kept as `room.host` while its name was taken here gets it back once it is free.
  for (const name of workspaceNames(rootDir())) void restoreRoomName(name);
}

/** `@st0/…` and the modules k7-core renamed, rewritten in each workspace whose replica this is to do it (docs/workspaces.md). */
function migrateLegacyNamespaces(): void {
  const paired = isPaired();
  for (const name of workspaceNames(rootDir())) {
    if (name === EXAMPLES_WORKSPACE) continue;
    const root = workspaceRoot(name);
    // A paired device leaves a synced workspace to its server, so one rewrite reaches every replica rather than several racing.
    if (paired && loadHead(liveLogFor(root)) > 0) continue;
    const changed = migrateNamespaceOnce(root);
    if (changed.length)
      console.log(
        `library | ${name}: ${changed.length} file(s) rewritten from @st0 to @k7-core`,
      );
  }
  if (!paired) migrateNamespaceOnce(accountLibraryHome());
}

/** Rename workspace folder `from` to `to` with everything filed by its path: its sync history, its active marker. */
async function renameWorkspaceFolder(from: string, to: string): Promise<void> {
  const fromRoot = workspaceRoot(from);
  const toRoot = workspaceRoot(to);
  closeModuleWatchesUnder(fromRoot);
  // Imported late: engineLink reaches back into this registry.
  const { unloadEngineIfServing } = await import("./engineLink.ts");
  await unloadEngineIfServing(fromRoot);
  // Sync lets go first, so the move is not captured as every file removed and added again.
  detachLiveCapture(fromRoot);
  for (const [key, ws] of live) if (ws.root === fromRoot) live.delete(key);
  renameSync(fromRoot, toRoot);
  if (existsSync(liveLogFor(fromRoot)))
    renameSync(liveLogFor(fromRoot), liveLogFor(toRoot));
  if (existsSync(activeMarkerOf(fromRoot)))
    renameSync(activeMarkerOf(fromRoot), activeMarkerOf(toRoot));
  const owner = rootOwner();
  if (owner) forgetListing(slugify(owner));
  joinWorkspace(to);
}

/** The workspace `name`, renamed to its room's name when it differs and nothing here holds that name; answers its name now. */
export async function restoreRoomName(name: string): Promise<string> {
  const room = roomAt(workspaceRoot(name));
  if (!room || room === name) return name;
  try {
    if (existsSync(workspaceRoot(room))) return name;
    await renameWorkspaceFolder(name, room);
    return room;
  } catch (e) {
    console.warn(
      `sync | '${name}' could not take back its name '${room}': ${(e as Error).message}`,
    );
    return name;
  }
}

let accountLibrary: Workspace | null = null;

/** The account's own library, synced like a workspace in the room ACCOUNT_LIBRARY_ROOM — docs/library-versions-plan.md. */
function attachAccountLibrary(): void {
  if (accountLibrary || !rootOwner()) return;
  const root = accountLibraryHome();
  mkdirSync(root, { recursive: true });
  accountLibrary = new Workspace(root);
  attachLiveCapture(accountLibrary, ACCOUNT_LIBRARY_ROOM);
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
  // Sync FIRST: emptied on its server and told it ends, or it comes back, empty, on the next join (docs/workspaces.md).
  await endWorkspace(root);
  rmSync(root, { recursive: true, force: true });
  // Its marker is beside it, not in it: a workspace made again under the name must not reopen a ghost.
  rmSync(activeMarkerOf(root), { force: true });
  forgetListing(slugify(userEmail));
}

/** The files under `dir` that are no folder, counted to a bound: whether anything is left worth keeping. */
function filesUnder(dir: string, bound = 1): number {
  let n = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (n >= bound) return;
      if (e.isDirectory()) walk(join(d, e.name));
      else n++;
    }
  };
  try {
    walk(dir);
  } catch {
    return 0;
  }
  return n;
}

/** Another replica ENDED workspace `name` — deleted it, or moved it away: its folder goes, unless something never synced is left in it. */
export async function dropEndedWorkspace(name: string): Promise<void> {
  const root = workspaceRoot(name);
  if (!existsSync(root)) return;
  // What sync knew is removed already; a file still here is one it never held — a backup, a local-only file.
  if (filesUnder(root)) {
    console.warn(
      `sync | '${name}' was ended elsewhere; kept here, since it holds files that never synced`,
    );
    return;
  }
  closeModuleWatchesUnder(root);
  // Imported late: engineLink reaches back into this registry.
  const { unloadEngineIfServing } = await import("./engineLink.ts");
  await unloadEngineIfServing(root);
  rmSync(root, { recursive: true, force: true });
  rmSync(activeMarkerOf(root), { force: true });
  for (const [key, ws] of live) if (ws.root === root) live.delete(key);
  const owner = rootOwner();
  if (owner) forgetListing(slugify(owner));
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

/** Every workspace on this machine, with its projects — what k7's home page draws (docs/workspaces.md). */
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
    const active = activeOf(abs);
    // A workspace whose capture heard nothing since its row was built is not walked again (docs/workspaces.md).
    const capture = attachedAt(abs)?.capture;
    const gen = capture?.watching ? capture.generation : -1;
    const kept = rowsKept.get(abs);
    if (
      kept &&
      gen >= 0 &&
      kept.gen === gen &&
      Date.now() - kept.at < LISTING_STILL_MS
    )
      return withActive(kept.row, abs, active);
    const row = workspaceRow(name, abs, active);
    if (gen >= 0) rowsKept.set(abs, { gen, at: Date.now(), row });
    else rowsKept.delete(abs);
    return row;
  });
  listings.set(slug, { at: Date.now(), rows });
  return rows;
}

/** One workspace's row of the home page, walked and read afresh. */
function workspaceRow(
  name: string,
  abs: string,
  active: string | null,
): AccountWorkspace {
  const single = isProjectDir(abs);
  return {
    name,
    isSingleProject: single,
    projects: (single ? ["."] : projectDirsUnder(abs)).flatMap((path) => {
      // `.` names the workspace folder itself; either way the NAME decides, the one rule both ends use.
      const app = projectApp(path === "." ? name : path.split("/").pop()!);
      if (!app) return [];
      const at = join(abs, path);
      const tags = tagsOf(at);
      // What the home page's row says beyond the name: the archetype, the open one, the last change (docs/workspaces.md).
      const facts = {
        surfaces: projectSurfaces(at).surfaces.map((s) => s.surface.type),
        active: active !== null && active === resolve(at),
        editedAt: projectEditedAt(at),
        // A demo is overwritten on the next start, so the home page marks it rather than letting edits vanish.
        ...(isManagedDemo(name, path) ? { demo: true } : {}),
      };
      return [
        tags.length ? { path, app, tags, ...facts } : { path, app, ...facts },
      ];
    }),
  };
}

/** A kept row with its open project read again: the marker lives outside the workspace, where no capture hears it. */
function withActive(
  row: AccountWorkspace,
  abs: string,
  active: string | null,
): AccountWorkspace {
  return {
    ...row,
    projects: row.projects.map((p) => ({
      ...p,
      active: active !== null && active === resolve(join(abs, p.path)),
    })),
  };
}

/** A k7 project's tags, read from its project.k7x; none when there is no such file. */
function tagsOf(projectDir: string): string[] {
  try {
    return projectTagsOf(wsRead(join(projectDir, "project.k7x")));
  } catch {
    return [];
  }
}

/** The window under the listing above, so a polling home page does not walk every tree per tick (docs/workspaces.md). */
const LISTING_RESCAN_MS = 5_000;
const listings = new Map<string, { at: number; rows: AccountWorkspace[] }>();
/** …and how long one workspace's row is kept while its capture hears nothing move. */
const LISTING_STILL_MS = 60_000;
const rowsKept = new Map<
  string,
  { gen: number; at: number; row: AccountWorkspace }
>();
// Both listings, since the second is built on the first — see docs/workspaces.md.
export const forgetListing = (slug: string) => {
  listings.delete(slug);
  surfaced.delete(slug);
  rowsKept.clear();
};

/** Every project that DECLARES a surface, flat — what k7's `/external` page draws (docs/workspaces.md). */
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
