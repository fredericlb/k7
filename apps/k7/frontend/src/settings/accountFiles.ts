// accountFiles.ts — which file service a page that opens no project acts on: the account's, on the
// server, whether or not an engine answers. The home page and the settings share it, since the
// module-level file transport is unconfigured there. An engine only rides along in the ticket.

import { fileTokenOf } from "@studio/engine-browser/probe";
import { api, engines } from "../api";
import type { AccountFiles } from "../projects/api";

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
