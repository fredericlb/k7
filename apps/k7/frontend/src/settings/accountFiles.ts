// accountFiles.ts — which file service a page that opens no project acts on: the account's, on the
// server, whether or not an engine answers. The home page and the settings share it, since the
// module-level file transport is unconfigured there. An engine only rides along in the ticket.

import { fileTokenOf } from "@studio/engine-browser/probe";
import {
  type AccountWorkspace,
  FILE_HUB_HELLO,
  type FileHubHello,
} from "@studio/web-protocol";
import { api, engines } from "../api";
import { type AccountFiles, accountFiles } from "../projects/api";
import { SERVER_BASE, serverChoice } from "../serverChoice";

/** The file service the Libraries page edits: this machine's, or the paired server's through the forward (../serverChoice.ts). */
export async function findLibraryFiles(): Promise<AccountFiles | null> {
  if (serverChoice() !== "server") return findAccountFiles(false);
  try {
    const me = await api.getMe().catch(() => null);
    const res = await fetch(`${SERVER_BASE}${FILE_HUB_HELLO}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const hello = (await res.json()) as FileHubHello;
    return {
      fileBase: `${SERVER_BASE}${hello.path}`,
      token: hello.ticket,
      userEmail: me?.email || me?.sub || "unknown",
      admin: hello.admin,
    };
  } catch {
    return null;
  }
}

/** The account's file service and the token its gate takes, or null when nothing answers; `bindEngine` waits for the probe so the chosen engine's machine is bound. */
export async function findAccountFiles(
  bindEngine = true,
): Promise<AccountFiles | null> {
  try {
    // Both at once: the hello needs no answer from /auth/me, only the cookie.
    const [me, hosted] = await Promise.all([
      api.getMe().catch(() => null),
      engines.hostedFiles(),
    ]);
    const userEmail = me?.email || me?.sub || "unknown";
    // The hub's hello says who is an admin; with no hub there is no origin list to edit.
    const admin = hosted?.admin ?? false;
    if (hosted && !bindEngine)
      return {
        fileBase: hosted.fileBase,
        token: hosted.fileToken,
        userEmail,
        admin,
      };
    const { chosen } = await engines.find().catch(() => ({ chosen: null }));
    const token = chosen ? fileTokenOf(chosen) : null;
    if (chosen?.fileBase && token)
      return { fileBase: chosen.fileBase, token, userEmail, admin };
    return hosted
      ? { fileBase: hosted.fileBase, token: hosted.fileToken, userEmail, admin }
      : null;
  } catch {
    return null;
  }
}

let homeFiles: Promise<AccountFiles | null> | null = null;
let homeWorkspaces: {
  files: AccountFiles;
  list: Promise<AccountWorkspace[]>;
} | null = null;

/** Start the home page's reads as its chunk arrives, once signed in: the account's files, then the workspace list (docs/projects.md). */
export function prefetchHome(): void {
  if (homeFiles) return;
  homeFiles = api
    .getMe()
    .then((me) => (me ? findAccountFiles(false) : null))
    .catch(() => null);
  void homeFiles.then((f) => {
    if (!f) return;
    const list = accountFiles.workspaces(f);
    // A failure is the page's own read to report, when it asks again.
    list.catch(() => {});
    homeWorkspaces = { files: f, list };
  });
}

/** `findAccountFiles(false)` for the home page, answered by the prefetch the first time. */
export function homeAccountFiles(): Promise<AccountFiles | null> {
  const p = homeFiles;
  homeFiles = null;
  return p ?? findAccountFiles(false);
}

/** The workspace list the prefetch asked for these files, handed out once; null when there is none to take. */
export function takePrefetchedWorkspaces(
  f: AccountFiles,
): Promise<AccountWorkspace[]> | null {
  const w = homeWorkspaces;
  homeWorkspaces = null;
  return w && w.files.fileBase === f.fileBase && w.files.token === f.token
    ? w.list
    : null;
}
