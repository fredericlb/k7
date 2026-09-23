// machine.ts — which machine the settings panel acts on: the engine this account would drive,
// found the way the home page finds it. The sections that read or change a machine's disk share
// it, since the panel opens no project and the module-level file transport is unconfigured.

import { api, engines } from "../api";
import type { Machine } from "../projects/api";

/** The chosen engine's file service and token, or null when no machine answers. */
export async function probeMachine(): Promise<Machine | null> {
  try {
    const me = await api.getMe().catch(() => null);
    const userEmail = me?.email || me?.sub || "unknown";
    const { chosen } = await engines.find();
    return chosen?.fileBase && chosen.token
      ? { fileBase: chosen.fileBase, token: chosen.token, userEmail }
      : null;
  } catch {
    return null;
  }
}
