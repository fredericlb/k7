// testHost.ts — a COMPLETE `CommandHost` for a test, of which a caller states only what matters.
//
// Suites used to build their own and finish it with `as never` — 128 of them, each switching the
// typer off on the object it had just written. Two things followed, both seen: a host missing a
// field the verb calls compiled and broke at runtime inside a test about something else, and an
// optional field set to `undefined` took the parameter default, so a "without this capability"
// test exercised a host that had it. That cost two false greens.
//
// Complete by construction here, so forgetting a field is a compile error rather than a surprise.

import type {
  AudioDeviceInfo,
  PluginInfo,
} from "@studio/engine-client/engineClient";
import type { ProjectDoc } from "@studio/song/project";
import type { CommandHost } from "./commands.ts";

/** Ce qu'un test lit après coup : les lignes des deux canaux, séparées comme le verbe les sépare. */
export interface HostLog {
  log: string[];
  refuse: string[];
}

/**
 * Un hôte complet, plus ce que le test veut changer.
 *
 * Les défauts sont INERTES, jamais des espions : ils ne renvoient rien et n'écrivent rien, donc un
 * verbe qui atteint une capacité que le test n'a pas nommée ne fait rien de visible plutôt que de
 * casser. Ce qui compte, ce sont les deux canaux, qui reviennent dans `lines`.
 *
 * Un projet vide par défaut : c'est ce que la plupart des refus exercent, et un test qui a besoin
 * de pistes passe le sien.
 */
export function testHost(
  over: Partial<CommandHost> = {},
): CommandHost & { lines: HostLog } {
  const lines: HostLog = { log: [], refuse: [] };
  const host: CommandHost & { lines: HostLog } = {
    lines,
    songPath: "",
    project: () => ({ tracks: [] }) as unknown as ProjectDoc,
    baseModules: [],
    log: (l) => lines.log.push(...l),
    refuse: (l) => lines.refuse.push(...l),
    reload: () => {},
    transport: () => {},
    arm: async () => undefined,
    applyProject: () => {},
    sendProject: () => {},
    listPlugins: () => {},
    rescanPlugins: () => {},
    showNativePluginUI: () => {},
    getPlugins: async () => [] as PluginInfo[],
    getAudioDevices: async () => [] as AudioDeviceInfo[],
    ...over,
  };
  return host;
}
