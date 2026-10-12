// config.ts — what the fetch layer needs from its host, set once by `configureRehearsal` before the
// first render. Module-level on purpose: api.ts, rtc.ts and pl8.ts are not components, so a React
// context cannot reach them; what a COMPONENT needs comes through host.tsx instead.

export interface RehearsalConfig {
  /** Where the rehearsal `/api/*` and `/rtc` answer — "" for the host's own origin root. */
  apiBase: string;
  /** The path the pages live under, for the links handed to someone else — a public page. */
  pagesPrefix: string;
}

const config: RehearsalConfig = { apiBase: "", pagesPrefix: "/rehearsal" };

/** Merge the host's settings in; a later call replaces only what it names. */
export function configureRehearsal(patch: Partial<RehearsalConfig>): void {
  Object.assign(config, patch);
}

export const apiBase = (): string => config.apiBase;

export const pagesPrefix = (): string => config.pagesPrefix;
