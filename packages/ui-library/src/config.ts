// config.ts — what the fetch layer needs from its host, set once by `configureLibrary` before the
// first render. Module-level on purpose: api.ts and enginePlayback.ts are not components, so a
// React context cannot reach them; everything a COMPONENT needs comes through host.tsx instead.
// See ../docs/host.md.

export interface LibraryConfig {
  /** Where the media library's `/api/*` answers — "" for the host's own origin root. */
  apiBase: string;
  /** Where THIS machine's own routes answer when `apiBase` is another server's: the engines, the hunt, the copies; unset is `apiBase`. */
  hostBase?: string;
  /** The paired server's library through this machine, where its songs open on demand (the phone); unset elsewhere. */
  serverBase?: string;
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

export const hostBase = (): string => config.hostBase ?? config.apiBase;

/** Whether the pages read this machine's own backend: its server settings are then the ones a page may open. */
export const readsThisMachine = (): boolean => hostBase() === config.apiBase;

/** The paired server through this machine, or null where songs are not opened from it on demand (../docs/songSource.md). */
export const serverBase = (): string | null => config.serverBase ?? null;
