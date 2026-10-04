// workspaceFiles.ts — the read-only calls the home page's workspace tree makes: one file's
// content, the uncommitted paths and one path's diff. Same transport as api.ts's `accountFiles`.

import {
  type FileContent,
  type GitChange,
  type GitChangeList,
  type GitDiffReply,
  WORKSPACE_HEADER,
} from "@studio/web-protocol";
import { type AccountFiles, filesHeaders, json } from "./api";

const get = async <T>(
  m: AccountFiles,
  workspace: string,
  path: string,
  what: string,
): Promise<T> =>
  json<T>(
    await fetch(`${m.fileBase}${path}`, {
      headers: { ...filesHeaders(m), [WORKSPACE_HEADER]: workspace },
    }),
    what,
  );

export const workspaceFiles = {
  read: (m: AccountFiles, workspace: string, path: string) =>
    get<FileContent>(
      m,
      workspace,
      `/file?path=${encodeURIComponent(path)}`,
      "file",
    ),

  changes: async (m: AccountFiles, workspace: string): Promise<GitChange[]> =>
    (await get<GitChangeList>(m, workspace, "/git/changes", "changes")).changes,

  diff: async (
    m: AccountFiles,
    workspace: string,
    path: string,
  ): Promise<string> =>
    (
      await get<GitDiffReply>(
        m,
        workspace,
        `/git/diff?path=${encodeURIComponent(path)}`,
        "diff",
      )
    ).diff,
};
