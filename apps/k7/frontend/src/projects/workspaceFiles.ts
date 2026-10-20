// workspaceFiles.ts — the read-only calls the home page's workspace tree makes: one file's
// content. Same transport as api.ts's `accountFiles`.

import { readJson as json } from "@studio/http-client/call";
import { type FileContent, WORKSPACE_HEADER } from "@studio/web-protocol";
import { type AccountFiles, filesHeaders } from "./api";

/** What the read-only tree and its viewer read through: one workspace's files. */
export interface TreeSource {
  /** Changes when the source does, so what was read of the last one is dropped. */
  key: string;
  read(path: string): Promise<FileContent>;
}

/** A workspace of the account, as the home page reads it. */
export const workspaceSource = (
  m: AccountFiles,
  workspace: string,
): TreeSource => ({
  key: `workspace:${workspace}`,
  read: (path) => workspaceFiles.read(m, workspace, path),
});

export const workspaceFiles = {
  read: async (
    m: AccountFiles,
    workspace: string,
    path: string,
  ): Promise<FileContent> =>
    json<FileContent>(
      await fetch(`${m.fileBase}/file?path=${encodeURIComponent(path)}`, {
        headers: { ...filesHeaders(m), [WORKSPACE_HEADER]: workspace },
      }),
      "file",
    ),
};
