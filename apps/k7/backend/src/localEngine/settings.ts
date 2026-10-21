// settings.ts — the one edit the host makes to the supervisor's engine-host.json before each start: this
// backend first among the registries, the person's own instances kept. Pure, so it is tested. See ../../docs/localEngine.md.

/** The supervisor's settings as read: anything it holds, of which only `registryUrls` is ours to touch. */
export type EngineHostSettings = Record<string, unknown>;

const origin = (u: string): string => {
  try {
    return new URL(u).origin;
  } catch {
    return u;
  }
};

/** `settings` with `local` as the first registry and no second copy of it; null when nothing changes. */
export function pinRegistry(
  settings: EngineHostSettings,
  local: string,
): EngineHostSettings | null {
  const was = Array.isArray(settings.registryUrls)
    ? settings.registryUrls.filter((u): u is string => typeof u === "string")
    : [];
  const kept = was.filter((u) => origin(u) !== origin(local));
  const registryUrls = [local, ...kept];
  if (JSON.stringify(registryUrls) === JSON.stringify(settings.registryUrls))
    return null;
  return { ...settings, registryUrls };
}
