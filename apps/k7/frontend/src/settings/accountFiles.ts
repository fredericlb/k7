// accountFiles.ts — which file service a page that opens no project acts on: the account's, on the
// server, whether or not an engine answers. The home page and the settings share it, since the
// module-level file transport is unconfigured there. An engine only rides along in the ticket.

import { fileTokenOf } from "@studio/engine-browser/probe";
import { FILE_HUB_HELLO, type FileHubHello } from "@studio/web-protocol";
import { api, engines } from "../api";
import type { AccountFiles } from "../projects/api";
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
    const me = await api.getMe().catch(() => null);
    const userEmail = me?.email || me?.sub || "unknown";
    const hosted = await engines.hostedFiles();
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
