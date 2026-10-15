// store.ts — the five calls the builder needs from whatever is serving the files. This is the
// ONLY thing the two apps don't share: k7 talks to a file service over workspace-relative
// paths, the médiathèque to its own backend over library-relative ones. Rationale: docs/store.md.

import type {
  Hints,
  ModuleSidecarFile,
  ModuleUiFile,
} from "@studio/web-protocol";

/** Where a save actually landed. Empty for an ordinary write; see `write`. */
export interface Written {
  /** The path the content is in NOW, when that is not the one asked for. */
  path?: string;
  /** What to tell the user about the redirection, in the host's own words. */
  note?: string;
}

/** What the builder asks its host for, all in the HOST's path space — see docs/store.md. */
export interface ModuleStore {
  /** One file's text, or NULL when there is none: absence is a state, not an error. */
  read(path: string): Promise<string | null>;

  /** The `ui.yaml` beside a module file, or the path it WOULD take plus a blank grid. */
  moduleUi(path: string): Promise<ModuleUiFile>;

  /** The DSP source, `file` being its NAME so the host writes the right stub — see docs/store.md. */
  dspSource?(path: string, file: string): Promise<ModuleSidecarFile>;

  /** The `widgets.js` beside the module, answered like the panel — its lcdscreen widgets' drawing; docs/store.md. */
  widgetsScript?(path: string): Promise<ModuleSidecarFile>;

  /** The ENGINES beside a module file and the one it runs; absent is a host with none (packages/song/docs/engines.md). */
  engines?(path: string): Promise<{ engines: string[]; engine?: string }>;

  /** What the code pane completes against. A host with nothing to offer returns empty lists. */
  hints(): Promise<Hints>;

  /** Save; the return type exists for the ONE host that redirects a write — see docs/store.md. */
  write(path: string, content: string): Promise<Written>;

  /** Make what was written visible to everyone else — called ONCE, after all four land; docs/store.md. */
  publish?(path: string): Promise<{ note?: string }>;

  /** Keep the plugin's CURRENT state as a named base in the module's `base/` folder — docs/store.md. */
  snapshotBase?(
    path: string,
    name: string,
    ref: string,
  ): Promise<{ path: string }>;

  /** The named bases this module may be set to, its ancestry included — see docs/store.md. */
  bases?(path: string): Promise<string[]>;
}
