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

/** What a test reads afterwards: both channels' lines, kept apart as the verb keeps them. */
export interface HostLog {
  log: string[];
  refuse: string[];
}

/** A complete host with INERT defaults — never spies — and an empty project unless one is given. */
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
