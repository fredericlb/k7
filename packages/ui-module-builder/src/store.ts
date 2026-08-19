// store.ts — the five calls the builder needs from whatever is serving the files. This is the
// ONLY thing the two apps don't share: l8 talks to a file service over workspace-relative
// paths, the médiathèque to its own backend over library-relative ones. Rationale: docs/store.md.

import type {
  Hints,
  ModulePresetsFile,
  ModuleUiFile,
} from "@studio/web-protocol";

/** Where a save actually landed. Empty for an ordinary write; see `write`. */
export interface Written {
  /** The path the content is in NOW, when that is not the one asked for. */
  path?: string;
  /** What to tell the user about the redirection, in the host's own words. */
  note?: string;
}

/**
 * What the builder asks its host for.
 *
 * Five calls, all in the host's own path space — the builder never builds a path except by passing back one
 * it was given. That is what lets the same component sit over a workspace and over a hosted library without
 * knowing which it is, and it is why the two sidecars are asked for rather than derived here: a sibling
 * derivation would be right in both spaces today and is exactly the kind of rule that rots.
 */
export interface ModuleStore {
  /**
   * One file's text, or NULL when there is none there.
   *
   * All three of a module's files may be absent — a folder somebody just made is a module with
   * nothing in it yet, and the médiathèque lists one on purpose so it can be dropped into. So
   * absence is a state, not an error: the builder opens on an empty buffer and the first save
   * creates the file, exactly as it already did for the panel and the shelf. Throwing turned
   * that into "couldn't open … — not found" over a folder that was plainly there.
   */
  read(path: string): Promise<string | null>;

  /**
   * The `ui.yaml` beside a module file — the existing one, or the path it WOULD take plus a
   * blank grid. `path` may name either file of the pair (see `@studio/song`'s uiLibrary.ts).
   */
  moduleUi(path: string): Promise<ModuleUiFile>;

  /**
   * The `presets.yaml` beside a module file — the module's named settings, answered like the panel above.
   * Absent is not an error: the shelf is created by the first save.
   */
  presets(path: string): Promise<ModulePresetsFile>;

  /**
   * The `jsdsp.ts` beside a module file — the module's own DSP source, answered like the two
   * above: the existing one, or the path it WOULD take and empty text.
   *
   * OPTIONAL, and the only optional call here. A host that does not implement it simply shows no
   * such tab, which is the honest answer for one that cannot serve the file. Asked for rather
   * than derived, for the same reason the panel and the shelf are: a sibling derivation would be
   * right in both path spaces today and is exactly the kind of rule that rots.
   */
  jsdsp?(path: string): Promise<ModulePresetsFile>;

  /** What the code pane completes against. A host with nothing to offer returns empty lists. */
  hints(): Promise<Hints>;

  /**
   * Save.
   *
   * The return type exists for ONE host: l8 redirects a save aimed at a shared module onto a
   * project-local copy and repoints the chains at it (see moduleFork.ts), so the file being edited
   * moves out from under the editor. Reporting it beats the builder discovering it on the next read.
   */
  write(path: string, content: string): Promise<Written>;

  /**
   * Make the files that were just written visible to everyone else.
   *
   * OPTIONAL, and only one host implements it: l8 commits and pushes the LIBRARY repository a
   * shared module lives in (`packages/song/docs/sharedFolders.md`). A host without one — or a
   * module that is the project's own — passes nothing and the save simply ends at the disk.
   *
   * Called ONCE, after every dirty file has landed, and never per file: the four files of a
   * module are one edit, and four commits for one edit is a history nobody can read. It is
   * given the module's path so the host can decide whether this module is publishable at all;
   * `note` is what to tell the user, in the host's own words.
   */
  publish?(path: string): Promise<{ note?: string }>;

  /**
   * Keep the plugin's CURRENT state as a named base in the module's own `base/` folder.
   *
   * A base is an opaque `.vstpreset` blob, for the plugins whose sound is not in their automatable
   * parameters — which `presets.yaml` cannot hold, being named numbers. Snapshotting reads the
   * instance behind the "Native UI" window, so what is kept is what somebody dialled in by hand.
   *
   * HERE rather than as an `on…` prop, even though half of it is an engine call: the other half
   * writes a file in the module's folder, and this interface exists precisely so the builder never
   * works out such a path itself. It passes back the `path` it was given and the ref it read out
   * of the module's own text, and the host resolves where that lands in its own space.
   *
   * OPTIONAL, like `jsdsp` and `publish`: a host with no engine, or one that serves files it
   * cannot write blobs beside, simply shows no button. Rejects with something worth reading — no
   * window opened yet is the common one, and it is the user's to fix.
   */
  snapshotBase?(
    path: string,
    name: string,
    ref: string,
  ): Promise<{ path: string }>;
}
