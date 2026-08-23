// services.ts — where each studio service answers. One origin, one fixed path per service,
// stated once so nothing derives it a second way. Browser-safe: no node imports, because the
// SPAs, the file service and the supervisor all have to agree about this.

/** Where each service is mounted, FIXED, and `st0` deliberately `""` — spell auth routes BARE; docs/addresses.md. */
export const SERVICE_PATHS = {
  st0: "",
  pl8: "/pl8",
  k7: "/k7",
  z0: "/z0",
} as const;

export type StudioService = keyof typeof SERVICE_PATHS;

/** The hosted studio. A constant and not a setting, for the same reason the paths are. */
export const STUDIO_ORIGIN = "https://studio.frediver.se";

/** Each backend's port — what a SERVER calls, since node does not trust the dev CA; see docs/addresses.md. */
export const SERVICE_PORTS: Record<StudioService, number> = {
  st0: 8789,
  pl8: 8795,
  k7: 8787,
  z0: 8080,
};

/** Where a service answers on the machine it runs on. See SERVICE_PORTS for when to prefer it. */
export function localServiceUrl(service: StudioService): string {
  return `http://127.0.0.1:${SERVICE_PORTS[service]}`;
}

/** Where a service is; `origin` may be any URL on that origin, since everything but the origin is dropped. */
export function serviceUrl(origin: string, service: StudioService): string {
  return studioOrigin(origin) + SERVICE_PATHS[service];
}

/** The bare origin of any studio URL; "" for a string that is not a URL at all, never a throw. */
export function studioOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
