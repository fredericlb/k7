// workspaceOps.ts — creating a workspace, and creating, copying, renaming and deleting a project, go
// through the account's file service on the server: that is where the workspaces live, and the
// live-sync relay carries every change on to the other replicas. See ../../docs/projects.md.

import type { ProjectShape } from "@studio/song-schema/yaml/projectSchema";
// `m` is the file service in every function here, so the catalogue comes in under its own name.
import { m as msg } from "../paraglide/messages.js";
import { type AccountFiles, accountFiles } from "./api";

export type { AccountFiles };

/** A workspace of one's own with NOTHING in it, synced with the active server if any: the editor asks for the archetype. */
export async function createWorkspace(
  m: AccountFiles,
  name: string,
  onStep: (s: string) => void,
): Promise<{ workspace: string }> {
  onStep(msg["ops.creating"]({ name }));
  await accountFiles.createWorkspace(m, name);
  return { workspace: name };
}

/** Scaffold a project of one of the archetypes in a workspace; the answer is its folder and the library modules it still owes. */
export async function createProject(
  m: AccountFiles,
  workspace: string,
  folder: string,
  onStep: (s: string) => void,
  shape: ProjectShape,
): Promise<{ project: string; missing: string[] }> {
  onStep(msg["ops.creating"]({ name: folder }));
  return accountFiles.createProject(m, workspace, folder, shape);
}

/** Copy a project into ANOTHER workspace; the answer is the copy's folder there. */
export async function copyProject(
  m: AccountFiles,
  from: string,
  path: string,
  to: string,
  name: string,
  onStep: (s: string) => void,
): Promise<string> {
  onStep(msg["ops.copying"]({ path, to }));
  return accountFiles.copyProject(m, from, path, to, name);
}

/** Rename a project's folder in place; the answer is its new path. */
export async function renameProject(
  m: AccountFiles,
  workspace: string,
  path: string,
  name: string,
  onStep: (s: string) => void,
): Promise<string> {
  onStep(msg["ops.renaming"]({ path, name }));
  return accountFiles.renameProject(m, workspace, path, name);
}

/** Delete a project: the service unloads it and moves its folder to the workspace's recycle bin. */
export async function deleteProject(
  m: AccountFiles,
  workspace: string,
  path: string,
  onStep: (s: string) => void,
): Promise<void> {
  onStep(msg["ops.deleting"]({ path }));
  await accountFiles.deleteProject(m, workspace, path);
}
