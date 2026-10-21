// settings.ts — the one edit the host makes to the supervisor's engine-host.json before each start: this
// backend first among the registries, the person's own servers kept. Pure, so it is tested. See ../../docs/localEngine.md.

import { isLoopbackHost } from "@studio/web-protocol/services";

/** The supervisor's settings as read: anything it holds, of which only `registryUrls` is ours to touch. */
export type EngineHostSettings = Record<string, unknown>;

/** Whether `u` names this machine; the supervisor reaches every such registry at one port, k7's (Url.cpp). */
const onLoopback = (u: string): boolean => {
  try {
    return isLoopbackHost(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** `settings` with `local` as the first registry and no other on loopback; null when nothing changes. */
export function pinRegistry(
  settings: EngineHostSettings,
  local: string,
): EngineHostSettings | null {
  const was = Array.isArray(settings.registryUrls)
    ? settings.registryUrls.filter((u): u is string => typeof u === "string")
    : [];
  // Another loopback entry is this backend spelt otherwise: two would hold two tunnels that displace each other.
  const kept = was.filter((u) => !onLoopback(u));
  const registryUrls = [local, ...kept];
  if (JSON.stringify(registryUrls) === JSON.stringify(settings.registryUrls))
    return null;
  return { ...settings, registryUrls };
}
