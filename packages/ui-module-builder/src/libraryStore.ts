// libraryStore.ts — the ModuleStore for a host whose files are the médiathèque's: read and
// write one path, and the three sidecars are the siblings of the file you were given. One
// implementation for the two hosts that edit shared modules — pl8's own screen and l8's
// Libraries tab. Rationale: docs/store.md.

import { JSDSP_FILE } from "@studio/engine-protocol/build";
import type {
  Hints,
  ModulePresetsFile,
  ModuleUiFile,
} from "@studio/web-protocol";
import type { ModuleStore } from "./store";

/** A module's panel and its shelf, by the name they take in every library. */
const UI_FILE = "ui.yaml";
const PRESETS_FILE = "presets.yaml";

/**
 * The three calls a médiathèque-shaped host owes this store.
 *
 * Deliberately smaller than `ModuleStore`: a library serves FILES, and everything the builder
 * asks for beyond a file is derived below rather than routed. That is why this can be shared —
 * what differs between the two hosts is the origin, the credentials and what happens after a
 * write, none of which is the shape of a module.
 */
export interface LibraryFileIO {
  /** One library file's text, or null when the library hasn't got it. Absent is not an error. */
  read(path: string): Promise<string | null>;
  /** Write it back. The library REPLACES — there is no fork here, which is the whole point. */
  write(path: string, content: string): Promise<void>;
  /** What the code pane completes against. A host with nothing to offer answers empty lists. */
  hints(): Promise<Hints>;
}

/**
 * The store, over a library.
 *
 * The sidecars are derived and not asked for, unlike l8's workspace store, and the difference
 * is real rather than an inconsistency: over a workspace the SERVER decides where a panel would
 * go, because a shared module's panel does not land beside the copy that forked. A library has
 * one place for every file — the module's own folder — so there is nothing to ask.
 */
export function libraryModuleStore(io: LibraryFileIO): ModuleStore {
  /** `modules/<type>/<sub>/<file>` → the folder's ref, and one named file inside it. */
  const sibling = (path: string, name: string) => {
    const parts = path.split("/");
    return {
      ref: parts.slice(1, -1).join("/"),
      at: [...parts.slice(0, -1), name].join("/"),
    };
  };

  /** A sidecar as the builder takes it: what is there, or where it WOULD go plus a starting text. */
  const read = async (
    path: string,
    name: string,
    blank: (ref: string) => string,
  ): Promise<ModuleUiFile> => {
    const { ref, at } = sibling(path, name);
    const content = await io.read(at).catch(() => null);
    return content == null
      ? { ref, path: at, content: blank(ref), exists: false }
      : { ref, path: at, content, exists: true };
  };

  return {
    read: (path) => io.read(path),
    moduleUi: (path) =>
      read(
        path,
        UI_FILE,
        (ref) => `# panel for ${ref}\ncols: 4\nrows: 2\nwidgets: {}\n`,
      ),
    presets: (path): Promise<ModulePresetsFile> =>
      read(path, PRESETS_FILE, (ref) => `# presets for ${ref}\n`),
    jsdsp: (path): Promise<ModulePresetsFile> =>
      read(
        path,
        JSDSP_FILE,
        // A stub that COMPILES, not an empty file: the loader RUNS this source to get the
        // graph, so a blank one fails on the first save rather than at some later moment.
        (ref) =>
          `// ${ref} — the module's DSP. Export the graph the engine will host.\nexport default {};\n`,
      ),
    hints: () => io.hints(),
    write: async (path, content) => {
      await io.write(path, content);
      // No redirection to report: a library is one place, and nothing here forks.
      return {};
    },
  };
}
