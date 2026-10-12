// config.ts — what the fetch layer needs from its host, set once by `configureLibrary` before the
// first render. Module-level on purpose: api.ts and enginePlayback.ts are not components, so a
// React context cannot reach them; everything a COMPONENT needs comes through host.tsx instead.
// See ../docs/host.md.

export interface LibraryConfig {
  /** Where the media library's `/api/*` answers — "" for the host's own origin root. */
  apiBase: string;
  /** The sentence a call that timed out throws, read at call time so it follows the locale. */
  noAnswer: (seconds: number) => string;
}

const config: LibraryConfig = {
  apiBase: "",
  noAnswer: (s) => `no answer from the server after ${s} s`,
};

/** Merge the host's settings in; a later call replaces only what it names. */
export function configureLibrary(patch: Partial<LibraryConfig>): void {
  Object.assign(config, patch);
}

export const libraryConfig = (): Readonly<LibraryConfig> => config;

export const apiBase = (): string => config.apiBase;
