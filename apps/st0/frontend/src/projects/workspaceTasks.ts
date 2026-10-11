// workspaceTasks.ts — every workspace's TODOS.md, read for the /tasks page: one file per workspace,
// parsed with the rules the `task` commands write it with. A workspace with no file has no tasks;
// that is an empty list, not an error. See ../../docs/tasks.md.

import { parseTasks, TASKS_FILE, type Task } from "@studio/song-schema/tasks";
import type { AccountWorkspace, RepoProject } from "@studio/web-protocol";
import type { AccountFiles } from "./api";
import { workspaceFiles } from "./workspaceFiles";

/** One workspace's tasks, or why they could not be read. */
export interface WorkspaceTasks {
  workspace: AccountWorkspace;
  tasks: Task[];
  error?: string;
}

/** The project a task's anchor names, among the workspace's own — both say `.` for a workspace that IS one project. */
export function anchorProject(
  ws: AccountWorkspace,
  at: Task["at"],
): RepoProject | undefined {
  if (!at) return undefined;
  const want = at.project.replace(/\\/g, "/").replace(/\/+$/, "");
  return ws.projects.find((p) => p.path.replace(/\\/g, "/") === want);
}

/** Read every workspace's file at once: one slow repository must not hold the others back. */
export async function readAllTasks(
  m: AccountFiles,
  workspaces: AccountWorkspace[],
): Promise<WorkspaceTasks[]> {
  return Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const { content } = await workspaceFiles.read(
          m,
          workspace.name,
          TASKS_FILE,
        );
        return { workspace, tasks: parseTasks(content) };
      } catch (e) {
        if ((e as { status?: number }).status === 404)
          return { workspace, tasks: [] };
        return { workspace, tasks: [], error: (e as Error).message };
      }
    }),
  );
}
