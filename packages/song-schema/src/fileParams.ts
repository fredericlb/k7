// fileParams.ts — the params whose value is a FILE rather than a number, and the library
// folders such a file may come from. Re-exported by moduleTypes.ts; see docs/moduleTypes.md.

/** The params whose value is a FILE the plugin loads, not a number — three tiers need the same list, docs/moduleTypes.md. */
export const FILE_PARAMS = ["model", "onnx"] as const;

/** An amp model is a NAM file or an RTNeural JSON (AIDA-X, Proteus) — engine/k7-runtime/docs/namPlugin.md. */
const PARAM_EXTS: Record<string, readonly string[]> = {
  model: [".nam", ".json"],
};

/** The extensions a file-valued param takes: its table entry, else its NAME — `onnx` loads `.onnx`, see docs/moduleTypes.md. */
export const assetExtsFor = (param: string): readonly string[] =>
  PARAM_EXTS[param] ?? [`.${param.toLowerCase()}`];

/** What a rack TAP's sample picker asks for: a library's `samples/`, the way `ir` asks for its `irs/`. */
export const TAP_SAMPLE = "sample";

/** Those of `files` a param of this name can take — a library pick only the `@<library>/…` sound files; a panel naming its `family` filters by that. */
export function assetsForParam(
  files: string[],
  param: string,
  family?: string,
): string[] {
  // A Faust slot's name is the program's own, so only the family the panel names can say what it takes.
  if (family && isLibraryFileFamily(family)) {
    const exts = LIBRARY_FILE_FAMILIES[family];
    return files.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
  }
  if (isLibraryFileParam(param) || param === TAP_SAMPLE)
    return files.filter((f) => f.startsWith("@") && isLibraryAudio(f));
  const exts = assetExtsFor(param);
  return files.filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
}
export type FileParam = (typeof FILE_PARAMS)[number];

/** File-valued params whose file is in a LIBRARY's shared folder, named `@<library>/<path>` — packages/song/docs/libraryFiles.md. */
export const LIBRARY_FILE_PARAMS = { ir: "irs" } as const;
export type LibraryFileParam = keyof typeof LIBRARY_FILE_PARAMS;
export const isLibraryFileParam = (name: string): name is LibraryFileParam =>
  Object.hasOwn(LIBRARY_FILE_PARAMS, name);

/** The sound files a library's `samples/` and `irs/` hold — what those folders are walked for. */
const LIBRARY_AUDIO_EXTS = [".wav", ".aif", ".aiff", ".flac"] as const;
const isLibraryAudio = (path: string): boolean =>
  LIBRARY_AUDIO_EXTS.some((e) => path.toLowerCase().endsWith(e));

/** File params a module may fill from its own `assets/` OR from a library's shared folder — packages/song/docs/libraryFiles.md. */
export const SHARED_FILE_PARAMS = { model: "models" } as const;
export type SharedFileFamily =
  (typeof SHARED_FILE_PARAMS)[keyof typeof SHARED_FILE_PARAMS];

/** The library folders that hold FILES rather than modules, and what each one is walked for. */
export const LIBRARY_FILE_FAMILIES = {
  samples: LIBRARY_AUDIO_EXTS,
  irs: LIBRARY_AUDIO_EXTS,
  // Single-cycle frames end to end, what a Faust wavetable instrument's `soundfile` reads (packages/song/docs/faustFiles.md).
  wavetables: LIBRARY_AUDIO_EXTS,
  models: [".nam", ".json"],
} as const;
export type LibraryFileFamily = keyof typeof LIBRARY_FILE_FAMILIES;
export const isLibraryFileFamily = (name: string): name is LibraryFileFamily =>
  Object.hasOwn(LIBRARY_FILE_FAMILIES, name);

/** Is `path` a file a library's `family` folder holds? */
export const isLibraryFileOf = (
  family: LibraryFileFamily,
  path: string,
): boolean =>
  LIBRARY_FILE_FAMILIES[family].some((e) => path.toLowerCase().endsWith(e));

/** The library folder a file param can ALSO name a file in, by `@<library>/<path>`; null for the rest. */
export const sharedFamilyOf = (param: string): SharedFileFamily | null =>
  Object.hasOwn(SHARED_FILE_PARAMS, param)
    ? SHARED_FILE_PARAMS[param as keyof typeof SHARED_FILE_PARAMS]
    : null;
export const isFileParam = (name: string): name is FileParam =>
  (FILE_PARAMS as readonly string[]).includes(name);
