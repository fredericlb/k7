// machine.ts — which file service the settings panel acts on: the account's, found the way the
// home page finds it. The sections that read or change the account's files share it, since the
// panel opens no project and the module-level file transport is unconfigured.

import { fileTokenOf } from "@studio/engine-browser/probe";
import { api, engines } from "../api";
import type { Machine } from "../projects/api";

/** The account's file service and the token its gate takes, or null when nothing answers. */
export async function probeMachine(): Promise<Machine | null> {
  try {
    const me = await api.getMe().catch(() => null);
    const userEmail = me?.email || me?.sub || "unknown";
    const { chosen } = await engines.find();
    const token = chosen ? fileTokenOf(chosen) : null;
    return chosen?.fileBase && token
      ? { fileBase: chosen.fileBase, token, userEmail }
      : null;
  } catch {
    return null;
  }
}
